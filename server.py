"""Four-party renovation collaboration, with transactional shared state."""
from contextlib import contextmanager
from datetime import datetime, timedelta
from functools import wraps
from io import BytesIO
from pathlib import Path
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time

from flask import Flask, g, jsonify, request, send_file
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash, check_password_hash

import domain as rules
from analysis_service import analyze, review_evidence

ROOT = Path(__file__).resolve().parent


def create_app(data_dir=None):
    app = Flask(__name__, static_folder='static')
    app.json.ensure_ascii = False
    app.config.update(MAX_CONTENT_LENGTH=10 * 1024 * 1024, MAX_FORM_PARTS=12)
    folder = Path(data_dir or os.getenv('TASKFLOW_DATA_DIR', str(ROOT / 'instance')))
    folder.mkdir(parents=True, exist_ok=True)
    database = folder / 'taskflow.sqlite3'
    with sqlite3.connect(database) as connection:
        connection.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
            role TEXT NOT NULL, password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
            csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS members (
            project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
            role TEXT NOT NULL, PRIMARY KEY(project_id, user_id));
        CREATE TABLE IF NOT EXISTS invitations (
            token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
            role TEXT NOT NULL, expires REAL NOT NULL, used_by TEXT);
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), change_id TEXT NOT NULL,
            version INTEGER NOT NULL, kind TEXT NOT NULL, reference TEXT NOT NULL,
            name TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL,
            uploaded_by TEXT NOT NULL REFERENCES users(id), at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_limits (ip TEXT PRIMARY KEY, since REAL NOT NULL, attempts INTEGER NOT NULL);
        ''')
    connection.close()

    def db():
        if 'db' not in g:
            g.db = sqlite3.connect(database, timeout=10, isolation_level=None)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys=ON')
        return g.db

    @contextmanager
    def transaction():
        connection = db()
        connection.execute('BEGIN IMMEDIATE')
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise

    @app.teardown_appcontext
    def close_db(_error):
        connection = g.pop('db', None)
        if connection:
            connection.close()

    def token_hash(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def payload():
        data = request.get_json(silent=True)
        rules.check(isinstance(data, dict), '请提交 JSON 对象。')
        return data

    @app.before_request
    def authenticate():
        if not request.path.startswith('/api/'):
            return
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('Origin')
            rules.check(not origin or origin == request.host_url.rstrip('/'), '请求来源不匹配。', 403)
        if request.path in ('/api/register', '/api/login', '/api/health'):
            return
        token = request.cookies.get('taskflow_session', '')
        row = db().execute('SELECT u.id,u.name,u.username,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?',
                           (token_hash(token), time.time())).fetchone()
        rules.check(row is not None, '请先登录。', 401)
        g.user = dict(row)
        g.csrf = g.user.pop('csrf')
        if request.method not in ('GET', 'HEAD'):
            rules.check(secrets.compare_digest(request.headers.get('X-CSRF-Token', ''), g.csrf), '登录状态已变化，请刷新页面。', 403)

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(rules.Problem)
    def domain_error(error):
        return jsonify(error=str(error)), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error='文件或请求过大。' if error.code == 413 else error.description), error.code

    @app.errorhandler(sqlite3.OperationalError)
    def database_error(error):
        if app.config['TESTING']:
            raise error
        app.logger.error('Database operation failed: %s', type(error).__name__)
        return jsonify(error='数据暂时繁忙，请重试。'), 503

    @app.get('/')
    def index():
        return app.send_static_file('index.html')

    @app.get('/api/health')
    def health():
        return jsonify(ok=True)

    def auth_rate_limit():
        ip = request.remote_addr or 'unknown'
        with transaction() as connection:
            row = connection.execute('SELECT * FROM auth_limits WHERE ip=?', (ip,)).fetchone()
            if row and row['since'] > time.time() - 900:
                rules.check(row['attempts'] < 60, '尝试次数较多，请稍后再试。', 429)
                connection.execute('UPDATE auth_limits SET attempts=attempts+1 WHERE ip=?', (ip,))
            else:
                connection.execute('INSERT OR REPLACE INTO auth_limits VALUES(?,?,?)', (ip, time.time(), 1))

    def login_response(user):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with transaction() as connection:
            connection.execute('DELETE FROM sessions WHERE expires<? OR token_hash=?', (time.time(), token_hash(request.cookies.get('taskflow_session', ''))))
            connection.execute('INSERT INTO sessions VALUES(?,?,?,?)', (token_hash(token), user['id'], csrf, time.time() + 86400 * 7))
        response = jsonify(user={k: user[k] for k in ('id', 'username', 'name', 'role')}, csrf=csrf)
        response.set_cookie('taskflow_session', token, max_age=86400 * 7, httponly=True, samesite='Lax',
                            secure=os.getenv('TASKFLOW_SECURE_COOKIE') == '1' or request.is_secure)
        return response

    @app.post('/api/register')
    def register():
        data = payload()
        auth_rate_limit()
        username = rules.required(data.get('username'), '用户名', 40).lower()
        rules.check(re.fullmatch(r'[a-z0-9_@.\-]{3,40}', username), '用户名使用 3–40 位字母、数字、下划线或邮箱字符。')
        name = rules.required(data.get('name'), '姓名', 40)
        role = data.get('role')
        rules.check(role in rules.ROLES, '请选择四方身份之一。')
        password = data.get('password')
        rules.check(isinstance(password, str) and 8 <= len(password) <= 128, '密码需要 8–128 个字符。')
        user = {'id': rules.ident(), 'username': username, 'name': name, 'role': role}
        hashed = generate_password_hash(password)
        try:
            with transaction() as connection:
                connection.execute('INSERT INTO users VALUES(?,?,?,?,?)', (*user.values(), hashed))
        except sqlite3.IntegrityError:
            raise rules.Problem('用户名已注册，请登录或换一个用户名。', 409)
        return login_response(user)

    @app.post('/api/login')
    def login():
        data = payload()
        auth_rate_limit()
        username = rules.required(data.get('username'), '用户名', 40).lower()
        password = data.get('password')
        rules.check(isinstance(password, str) and 0 < len(password) <= 128, '请输入密码。')
        user = db().execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        rules.check(user is not None and check_password_hash(user['password_hash'], password), '用户名或密码错误。', 401)
        return login_response(dict(user))

    @app.get('/api/me')
    def me():
        return jsonify(user=g.user, csrf=g.csrf)

    @app.post('/api/logout')
    def logout():
        db().execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(request.cookies.get('taskflow_session', '')),))
        response = jsonify(ok=True)
        response.delete_cookie('taskflow_session')
        return response

    def members(project_id):
        return [dict(row) for row in db().execute('SELECT u.id,u.name,u.username,m.role FROM members m JOIN users u ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.name', (project_id,))]

    def project_row(project_id):
        row = db().execute('SELECT p.* FROM projects p JOIN members m ON m.project_id=p.id WHERE p.id=? AND m.user_id=?', (project_id, g.user['id'])).fetchone()
        rules.check(row is not None, '项目不存在或你尚未加入。', 404)
        return row

    def files(project_id):
        return [dict(row) for row in db().execute('SELECT f.id,f.project_id,f.change_id,f.version,f.kind,f.reference,f.name,f.size,f.at,u.name AS uploaded_by FROM files f JOIN users u ON u.id=f.uploaded_by WHERE project_id=? ORDER BY f.at,f.id', (project_id,))]

    def project_view(project_id):
        row = project_row(project_id)
        project = json.loads(row['data'])
        attachments = files(project_id)
        for change in project['changes']:
            change['blockers'] = {kind: rules.blockers(change, attachments, kind) for kind in ('design', 'construction', 'owner', 'publish')}
            change['plans'] = rules.plans(change)
        return {'id': project_id, 'revision': row['revision'], 'title': row['title'], 'data': project,
                'members': members(project_id), 'files': attachments}

    @contextmanager
    def edit_project(project_id, expected):
        with transaction() as connection:
            row = project_row(project_id)
            rules.check(type(expected) is int and expected == row['revision'], '项目已由其他成员更新，请刷新后重试。', 409)
            project = json.loads(row['data'])
            yield project
            connection.execute('UPDATE projects SET data=?,revision=revision+1 WHERE id=?', (json.dumps(project, ensure_ascii=False), project_id))

    @app.get('/api/projects')
    def list_projects():
        return jsonify(projects=[dict(row) for row in db().execute('SELECT p.id,p.title,p.revision,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.rowid DESC', (g.user['id'],))])

    @app.post('/api/projects')
    def create_project():
        rules.check(g.user['role'] == 'coordinator', '请由中介方创建项目并邀请其他参与方。', 403)
        data = payload()
        title = rules.required(data.get('title'), '项目名称', 100)
        baseline = {'version': 1, 'text': rules.required(data.get('baseline'), '原方案说明'),
                    'reference': rules.required(data.get('reference'), '原图纸或方案版本', 100), 'finish_date': data.get('finish_date') or None}
        if baseline['finish_date']:
            try:
                rules.date.fromisoformat(baseline['finish_date'])
            except (ValueError, TypeError):
                raise rules.Problem('原交付日期格式错误。')
        project = {'original_plan': baseline.copy(), 'plan': baseline.copy(), 'changes': [], 'events': [],
                   'synthetic': bool(data.get('synthetic'))}
        rules.event(project, g.user, '创建项目', title)
        project_id = rules.ident()
        with transaction() as connection:
            connection.execute('INSERT INTO projects VALUES(?,?,?,?)', (project_id, title, 1, json.dumps(project, ensure_ascii=False)))
            connection.execute('INSERT INTO members VALUES(?,?,?)', (project_id, g.user['id'], g.user['role']))
        return jsonify(project_view(project_id)), 201

    @app.get('/api/projects/<project_id>')
    def get_project(project_id):
        return jsonify(project_view(project_id))

    @app.post('/api/projects/<project_id>/invitations')
    def invite(project_id):
        rules.check(g.user['role'] == 'coordinator', '仅中介方可邀请项目成员。', 403)
        data = payload()
        role = data.get('role')
        rules.check(role in rules.ROLES, '邀请角色无效。')
        token = secrets.token_urlsafe(24)
        with edit_project(project_id, data.get('revision')) as project:
            db().execute('INSERT INTO invitations VALUES(?,?,?,?,NULL)', (token_hash(token), project_id, role, time.time() + 86400 * 3))
            rules.event(project, g.user, '创建项目邀请', rules.ROLES[role])
        return jsonify(token=token, role=role, project=project_view(project_id))

    @app.post('/api/join')
    def join():
        data = payload()
        token = rules.required(data.get('token'), '邀请码', 100)
        with transaction() as connection:
            invite = connection.execute('SELECT * FROM invitations WHERE token_hash=?', (token_hash(token),)).fetchone()
            rules.check(invite is not None and invite['expires'] > time.time(), '邀请码无效或已过期。', 400)
            rules.check(invite['used_by'] is None, '邀请码已经使用。', 409)
            rules.check(invite['role'] == g.user['role'], '邀请码对应的身份与你的注册身份不同。', 403)
            try:
                connection.execute('INSERT INTO members VALUES(?,?,?)', (invite['project_id'], g.user['id'], g.user['role']))
            except sqlite3.IntegrityError:
                raise rules.Problem('你已经在这个项目中。', 409)
            connection.execute('UPDATE invitations SET used_by=? WHERE token_hash=?', (g.user['id'], token_hash(token)))
            row = connection.execute('SELECT data FROM projects WHERE id=?', (invite['project_id'],)).fetchone()
            project = json.loads(row['data'])
            rules.event(project, g.user, '加入项目', rules.ROLES[g.user['role']])
            connection.execute('UPDATE projects SET data=?,revision=revision+1 WHERE id=?', (json.dumps(project, ensure_ascii=False), invite['project_id']))
        return jsonify(project_view(invite['project_id']))

    @app.post('/api/projects/<project_id>/changes')
    def create_change(project_id):
        project_row(project_id)
        rules.check(g.user['role'] == 'owner', '请由住户账号提出装修要求。', 403)
        data = payload()
        text = rules.required(data.get('text'), '住户变更要求')
        analysis = analyze(text)
        with edit_project(project_id, data.get('revision')) as project:
            change = rules.new_change(project, g.user, text, members(project_id), analysis)
            change_id = change['id']
        return jsonify(project=project_view(project_id), change_id=change_id), 201

    @app.post('/api/projects/<project_id>/changes/<change_id>/<command>')
    def change_action(project_id, change_id, command):
        data = payload()
        with edit_project(project_id, data.get('revision')) as project:
            change = next((c for c in project['changes'] if c['id'] == change_id), None)
            rules.check(change is not None, '变更不存在。', 404)
            if command == 'revise':
                rules.revise(project, change, g.user, data, members(project_id))
            elif command == 'approve':
                rules.approve(project, change, g.user, data, files(project_id))
            elif command == 'publish':
                rules.publish(project, change, g.user, files(project_id))
            elif command == 'task':
                rules.handle_task(project, change, g.user, data, files(project_id))
            elif command == 'accept':
                rules.accept(project, change, g.user, data)
            elif command == 'comment':
                rules.event(project, g.user, '协商留言', rules.required(data.get('text'), '留言'), change_id)
            else:
                raise rules.Problem('操作不存在。', 404)
        return jsonify(project_view(project_id))

    @app.post('/api/projects/<project_id>/changes/<change_id>/files')
    def upload(project_id, change_id):
        kind = request.form.get('kind')
        rules.check(kind in ('drawing', 'quote', 'site'), '请选择文件用途。')
        allowed_roles = {'drawing': ('designer',), 'quote': ('contractor', 'coordinator'), 'site': ('contractor',)}
        rules.check(g.user['role'] in allowed_roles[kind], '当前身份无法上传此类资料。', 403)
        file = request.files.get('file')
        rules.check(file is not None and file.filename, '请选择文件。')
        name = file.filename.replace('\\', '/').split('/')[-1][:160]
        rules.check(Path(name).suffix.lower() in ('.pdf', '.png', '.jpg', '.jpeg', '.txt', '.docx'), '支持 PDF、图片、TXT 和 DOCX。')
        content = file.read(8 * 1024 * 1024 + 1)
        rules.check(0 < len(content) <= 8 * 1024 * 1024, '文件需在 8 MB 以内。')
        reference = rules.required(request.form.get('reference'), '文件版本或用途说明', 100)
        try:
            expected = int(request.form.get('revision', ''))
        except ValueError:
            raise rules.Problem('请刷新页面后再上传。')
        with edit_project(project_id, expected) as project:
            change = next((c for c in project['changes'] if c['id'] == change_id), None)
            rules.check(change is not None, '变更不存在。', 404)
            if kind in ('drawing', 'quote'):
                rules.check(change['status'] == 'clarifying', '请在澄清阶段补充审批资料。', 409)
                rules.check(not any(rules.approved(change, k) for k in rules.APPROVAL_ROLES), '当前版本已有确认，请先创建修订再补充审批材料。', 409)
            else:
                rules.check(change['status'] == 'executing', '请在施工任务发布后回传现场记录。', 409)
            db().execute('INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                         (rules.ident(), project_id, change_id, rules.current(change)['number'], kind, reference, name,
                          len(content), content, g.user['id'], rules.now()))
            rules.event(project, g.user, '上传资料', name + ' · ' + reference, change_id)
        return jsonify(project_view(project_id))

    @app.post('/api/projects/<project_id>/changes/<change_id>/evidence-review')
    def evidence_review(project_id, change_id):
        data = payload()
        view = project_view(project_id)
        change = next((c for c in view['data']['changes'] if c['id'] == change_id), None)
        rules.check(change is not None, '变更不存在。', 404)
        fields = rules.current(change)['data']
        candidates = [f for f in view['files'] if f['change_id'] == change_id and (
            f['kind'] == 'site' or f['reference'] == fields.get('drawing_version' if f['kind'] == 'drawing' else 'quote_reference'))]
        missing = [label for kind, label in [('drawing', '确认版设计图纸'), ('quote', '报价依据'), ('site', '施工交付记录')]
                   if not any(f['kind'] == kind for f in candidates)]
        documents = []
        for file in candidates[-12:]:
            if file['name'].lower().endswith('.txt'):
                content = db().execute('SELECT content FROM files WHERE id=?', (file['id'],)).fetchone()['content']
                documents.append({'name': file['name'], 'text': content.decode('utf-8-sig', errors='replace')[:6000]})
        report = review_evidence(fields, documents, missing)
        with edit_project(project_id, data.get('revision')) as project:
            target = next(c for c in project['changes'] if c['id'] == change_id)
            report.update(at=rules.now(), version=rules.current(target)['number'], by=g.user['name'])
            target.setdefault('evidence_reports', []).append(report)
            rules.event(project, g.user, '核对提交材料', f"缺项 {len(missing)} 项，待复核提示 {len(report['findings'])} 项。", change_id)
        return jsonify(project_view(project_id))

    @app.get('/api/files/<file_id>')
    def download(file_id):
        file = db().execute('SELECT * FROM files WHERE id=?', (file_id,)).fetchone()
        rules.check(file is not None, '文件不存在。', 404)
        project_row(file['project_id'])
        return send_file(BytesIO(file['content']), as_attachment=True, download_name=file['name'], mimetype='application/octet-stream')

    return app


if __name__ == '__main__':
    from waitress import serve
    port = int(os.getenv('TASKFLOW_PORT', '8765'))
    print(f'工序共识已启动：http://localhost:{port}', flush=True)
    serve(create_app(), host=os.getenv('TASKFLOW_HOST', '0.0.0.0'), port=port, threads=8, max_request_body_size=10 * 1024 * 1024)
