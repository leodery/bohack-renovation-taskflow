"""Project-specific proposal, approval and execution rules."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone, date
from decimal import Decimal, InvalidOperation
import uuid

TZ = timezone(timedelta(hours=8))
ROLES = {'owner': '住户', 'coordinator': '中介方 / 产品总监',
         'designer': '设计师', 'contractor': '施工团队'}
FIELD_ROLES = {
    'tile_spec': 'designer', 'layout': 'designer', 'start_point': 'designer',
    'edge_detail': 'designer', 'drawing_version': 'designer',
    'method': 'contractor', 'supplier': 'contractor', 'quote_scope': 'contractor', 'quote_reference': 'contractor',
    'quote_amount': 'contractor', 'quoted_at': 'contractor', 'valid_until': 'contractor',
    'arrival_date': 'contractor', 'crew_date': 'contractor', 'duration_days': 'contractor',
    'parallel_days': 'contractor', 'parallel_scope': 'contractor',
    'scheme': 'coordinator',
}
LABELS = {
    'tile_spec': '瓷砖规格', 'layout': '铺贴方式', 'start_point': '起铺点与方向',
    'edge_detail': '过门口收边', 'drawing_version': '图纸版本',
    'method': '施工方法与现场条件', 'supplier': '供应商名称', 'quote_reference': '报价单编号',
    'quote_scope': '变更报价范围（数量、规格、辅材、人工）', 'quote_amount': '变更增项总额',
    'quoted_at': '报价时间', 'valid_until': '报价有效期', 'arrival_date': '材料到货承诺',
    'crew_date': '班组最早可开工日', 'duration_days': '施工总日历天数',
}
APPROVAL_ROLES = {'design': 'designer', 'construction': 'contractor', 'owner': 'owner'}
APPROVAL_NAMES = {'design': '设计确认', 'construction': '施工与材料条件确认', 'owner': '费用与交付日期确认'}


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def ident():
    return uuid.uuid4().hex


def check(condition, message, status=400):
    if not condition:
        raise Problem(message, status)


def required(value, label, limit=2000):
    check(isinstance(value, str) and 0 < len(value.strip()) <= limit,
          f'请填写{label}，最长 {limit} 字。')
    return value.strip()


def current(change):
    return change['versions'][-1]


def member(members, user_id, role=None):
    found = next((m for m in members if m['id'] == user_id), None)
    check(found is not None and (role is None or found['role'] == role), '指定人员不在项目中或角色不匹配。')
    return found


def event(project, actor, action, detail, change_id=None):
    project['events'].append({'id': ident(), 'actor_id': actor['id'], 'actor_name': actor['name'],
                              'action': action, 'detail': detail, 'change_id': change_id, 'at': now()})


def new_change(project, actor, text, members, analysis):
    def first(role):
        return next((m['id'] for m in members if m['role'] == role), None)
    tasks = [
        {'id': 'materials', 'title': '核对瓷砖到场规格与数量', 'output': '到货凭据与核对记录', 'depends_on': []},
        {'id': 'preparation', 'title': '复核基层及现场开工条件', 'output': '现场条件复核记录', 'depends_on': []},
        {'id': 'installation', 'title': '按已确认图纸完成通铺', 'output': '施工过程记录与图纸对应说明', 'depends_on': ['materials', 'preparation']},
        {'id': 'self_check', 'title': '自检并提交交付资料', 'output': '自检说明与交付证据', 'depends_on': ['installation']},
    ]
    for task in tasks:
        task.update(owner_id=first('contractor'), reviewer_ids=[first('coordinator')] if first('coordinator') else [], due='')
    data = {key: None for key in FIELD_ROLES}
    data.update(scheme='sequential', parallel_days=0)
    change = {'id': ident(), 'source': {'author_id': actor['id'], 'author_name': actor['name'], 'text': text, 'at': now()},
              'status': 'clarifying', 'baseline': deepcopy(project['plan']), 'original_baseline': deepcopy(project['plan']), 'approvals': [], 'tasks': [],
              'versions': [{'number': 1, 'data': data, 'tasks': tasks, 'analysis': analysis,
                            'approvers': {key: first(role) for key, role in APPROVAL_ROLES.items()},
                            'reason': '住户提出变更', 'by': actor['name'], 'at': now()}]}
    project['changes'].append(change)
    current(change)['approvers']['owner'] = actor['id']
    event(project, actor, '提出变更', text, change['id'])
    return change


def validate_data(data):
    for key in ('arrival_date', 'crew_date'):
        if data.get(key):
            try:
                date.fromisoformat(data[key])
            except (ValueError, TypeError):
                raise Problem(f'{LABELS[key]}格式错误。')
    for key in ('quoted_at', 'valid_until'):
        if data.get(key):
            try:
                stamp = datetime.fromisoformat(data[key])
                check(stamp.tzinfo is not None, '报价时间需要包含时区。')
            except (ValueError, TypeError):
                raise Problem('报价时间格式错误。')
    if data.get('quoted_at') and data.get('valid_until'):
        check(datetime.fromisoformat(data['valid_until']) > datetime.fromisoformat(data['quoted_at']), '报价有效期应晚于报价时间。')
        check(datetime.fromisoformat(data['quoted_at']) <= datetime.now(TZ), '报价时间不能晚于当前时间。')
    if data.get('quote_amount') is not None:
        try:
            amount = Decimal(str(data['quote_amount']))
            check(amount.is_finite() and 0 <= amount <= 100000000 and amount.as_tuple().exponent >= -2, '报价必须为非负金额，最多两位小数。')
        except InvalidOperation:
            raise Problem('报价金额格式错误。')
    for key, low, high in [('duration_days', 1, 3650), ('parallel_days', 0, 3650)]:
        if data.get(key) is not None:
            check(type(data[key]) is int and low <= data[key] <= high, '工期天数必须为范围内的整数。')
    check(data.get('scheme') in ('sequential', 'parallel'), '请选择有效的施工方案。')
    if data.get('duration_days') and data.get('parallel_days'):
        check(data['parallel_days'] < data['duration_days'], '可追回天数应小于施工总天数。')


def revise(project, change, actor, payload, members):
    check(change['status'] in ('clarifying', 'returned'), '已发布的执行版本已锁定。需要进一步修改时请提出新变更。', 409)
    previous = current(change)
    revision = deepcopy(previous)
    changes = payload.get('fields', {})
    check(isinstance(changes, dict), '字段格式错误。')
    for key, value in changes.items():
        check(key in FIELD_ROLES and FIELD_ROLES[key] == actor['role'], '当前账号没有修改此类字段的权限。', 403)
        check(value is None or type(value) in (str, int), '字段值格式错误。')
        if isinstance(value, str):
            check(len(value) <= 2000, '字段内容过长。')
            value = value.strip() or None
        revision['data'][key] = value
    validate_data(revision['data'])
    if 'tasks' in payload or 'approvers' in payload:
        check(actor['role'] == 'coordinator', '仅中介方可组织任务分派。', 403)
        if 'approvers' in payload:
            approvers = payload['approvers']
            check(isinstance(approvers, dict) and set(approvers) == set(APPROVAL_ROLES), '确认事项不完整。')
            for kind, person in approvers.items():
                if person:
                    member(members, person, APPROVAL_ROLES[kind])
            revision['approvers'] = approvers
        if 'tasks' in payload:
            tasks = payload['tasks']
            check(isinstance(tasks, list) and len(tasks) == len(previous['tasks']), '请保留样板流程的四个执行任务。')
            check([t.get('id') for t in tasks] == [t['id'] for t in previous['tasks']], '任务编号或顺序错误。')
            for task, old in zip(tasks, previous['tasks']):
                check(task.get('depends_on') == old['depends_on'], '当前样板的施工依赖由流程模板规定。')
                task['title'] = required(task.get('title'), '任务名称', 100)
                task['output'] = required(task.get('output'), '交付物', 300)
                if task.get('owner_id'):
                    member(members, task['owner_id'], 'contractor')
                reviewers = task.get('reviewer_ids', [])
                check(isinstance(reviewers, list) and len(reviewers) == len(set(reviewers)), '确认人列表格式错误。')
                for person in reviewers:
                    member(members, person)
                    check(person != task.get('owner_id'), '请另选一名任务确认人。')
                if task.get('due'):
                    try:
                        date.fromisoformat(task['due'])
                    except (ValueError, TypeError):
                        raise Problem('任务截止日期格式错误。')
            revision['tasks'] = tasks
    revision.update(number=previous['number'] + 1, by=actor['name'], at=now(),
                    reason=required(payload.get('reason'), '本次修订原因', 500))
    revision['baseline'] = deepcopy(project['plan'])
    change['baseline'] = deepcopy(project['plan'])
    change['versions'].append(revision)
    change['status'] = 'clarifying'
    event(project, actor, '修订为 v' + str(revision['number']), revision['reason'], change['id'])


def approved(change, kind):
    version = current(change)['number']
    return any(a['version'] == version and a['kind'] == kind and a['decision'] == 'approve' for a in change['approvals'])


def plans(change):
    data = current(change)['data']
    needed = ['arrival_date', 'crew_date', 'duration_days']
    if any(data.get(key) is None for key in needed):
        return {'sequential': None, 'parallel': None}
    start = max(date.fromisoformat(data['arrival_date']), date.fromisoformat(data['crew_date']))
    sequential = {'start': start.isoformat(), 'finish': (start + timedelta(days=data['duration_days'] - 1)).isoformat()}
    parallel = None
    if data.get('parallel_scope') and (data.get('parallel_days') or 0) > 0:
        parallel = {'start': start.isoformat(), 'finish': (start + timedelta(days=data['duration_days'] - data['parallel_days'] - 1)).isoformat()}
    return {'sequential': sequential, 'parallel': parallel}


def blockers(change, files, kind='publish'):
    rev = current(change)
    data = rev['data']
    # Earlier files remain available as sources; each approval refers to the entire current revision.
    has = lambda category: any(f['kind'] == category and f['reference'] == data.get('drawing_version' if category == 'drawing' else 'quote_reference') for f in files if f['change_id'] == change['id'])
    issues = []
    design = ['tile_spec', 'layout', 'start_point', 'edge_detail', 'drawing_version']
    construction = ['method', 'supplier', 'quote_scope', 'quote_reference', 'quote_amount', 'quoted_at', 'valid_until',
                    'arrival_date', 'crew_date', 'duration_days']
    fields = design if kind == 'design' else design + construction
    for field in fields:
        if data.get(field) in (None, ''):
            issues.append('待补充' + LABELS[field])
    if not has('drawing'):
        issues.append('待上传设计图纸')
    if kind != 'design':
        if not has('quote'):
            issues.append('待上传报价依据')
        if data.get('valid_until') and datetime.fromisoformat(data['valid_until']) <= datetime.now(TZ):
            issues.append('报价已过期，需要重新询价')
        if not approved(change, 'design'):
            issues.append('等待指定设计师确认当前版本')
        if data.get('scheme') == 'parallel' and plans(change)['parallel'] is None:
            issues.append('并行方案需要施工方提供可并行工作及可追回天数')
    if kind in ('owner', 'publish') and not approved(change, 'construction'):
        issues.append('等待指定施工方确认当前版本')
    if kind == 'publish':
        if not approved(change, 'owner'):
            issues.append('等待住户确认费用与日期')
        for task in rev['tasks']:
            if not task.get('owner_id') or not task.get('reviewer_ids') or not task.get('due'):
                issues.append('待完善分派与截止日期 · ' + task['title'])
            if task.get('due'):
                by_id = {t['id']: t for t in rev['tasks']}
                if any(by_id[d].get('due', '') > task['due'] for d in task['depends_on']):
                    issues.append('截止日期早于前置任务 · ' + task['title'])
    return issues


def approve(project, change, actor, payload, files):
    check(change['status'] == 'clarifying', '请先修订重新提交，或查看已发布的执行计划。', 409)
    rev = current(change)
    kind = payload.get('kind')
    check(kind in APPROVAL_ROLES and rev['approvers'].get(kind) == actor['id'], '此确认事项未指派给你。', 403)
    check(not approved(change, kind), '此事项已确认。', 409)
    decision = payload.get('decision')
    check(decision in ('approve', 'return'), '请选择通过或退回。')
    note = required(payload.get('note'), '确认意见或退回原因', 1000)
    if decision == 'approve':
        issues = blockers(change, files, kind)
        check(not issues, '；'.join(issues), 409)
    else:
        change['status'] = 'returned'
    change['approvals'].append({'version': rev['number'], 'kind': kind, 'decision': decision,
                                'actor_id': actor['id'], 'actor_name': actor['name'], 'note': note, 'at': now()})
    event(project, actor, APPROVAL_NAMES[kind] + ('通过' if decision == 'approve' else '退回'), note, change['id'])


def publish(project, change, actor, files):
    check(actor['role'] == 'coordinator', '仅中介方可发布正式任务。', 403)
    check(change['status'] == 'clarifying', '当前变更已经发布或等待修订。', 409)
    check(change['baseline']['version'] == project['plan']['version'], '正式计划已更新，请创建修订并重新确认。', 409)
    issues = blockers(change, files)
    check(not issues, '；'.join(issues), 409)
    rev = current(change)
    selected = plans(change)[rev['data']['scheme']]
    check(selected is not None, '缺少完整工期输入。', 409)
    for task in rev['tasks']:
        check(selected['start'] <= task['due'] <= selected['finish'], '执行任务截止日期应在本次确认的施工期间内。', 409)
    change['tasks'] = deepcopy(rev['tasks'])
    for task in change['tasks']:
        task.update(status='ready', attempt=0, reviews=[], submissions=[])
    change['status'] = 'executing'
    change['published_version'] = rev['number']
    change['published_plan'] = deepcopy(selected)
    project['plan'] = {'version': project['plan']['version'] + 1, 'text': change['source']['text'],
                       'reference': rev['data']['drawing_version'], 'finish_date': selected['finish'],
                       'change_id': change['id'], 'change_version': rev['number']}
    event(project, actor, '发布正式任务', f"方案 v{rev['number']} 已确认，计划交付日 {selected['finish']}", change['id'])


def handle_task(project, change, actor, payload, files):
    check(change['status'] == 'executing', '当前阶段无法处理施工任务。', 409)
    task = next((t for t in change['tasks'] if t['id'] == payload.get('task_id')), None)
    check(task is not None, '任务不存在。', 404)
    note = required(payload.get('note'), '提交说明或确认意见', 1000)
    command = payload.get('command')
    if command == 'submit':
        check(task['owner_id'] == actor['id'], '此任务未指派给你。', 403)
        check(task['status'] in ('ready', 'returned'), '任务已提交。', 409)
        check(all(next(t for t in change['tasks'] if t['id'] == d)['status'] == 'approved' for d in task['depends_on']), '前置任务尚未确认完成。', 409)
        attachments = payload.get('file_ids', [])
        allowed = {f['id'] for f in files if f['change_id'] == change['id'] and f['kind'] == 'site'}
        check(isinstance(attachments, list) and attachments and set(attachments) <= allowed, '请选择本变更的施工证据文件。')
        task['attempt'] += 1
        task['status'] = 'submitted'
        task['submissions'].append({'attempt': task['attempt'], 'note': note, 'files': attachments, 'by': actor['name'], 'at': now()})
    elif command in ('approve', 'return'):
        check(actor['id'] in task['reviewer_ids'], '你没有此任务的确认权限。', 403)
        check(task['status'] == 'submitted', '请等待执行人提交材料。', 409)
        prior = [r for r in task['reviews'] if r['attempt'] == task['attempt']]
        check(not any(r['by_id'] == actor['id'] for r in prior), '你已经确认本次提交。', 409)
        task['reviews'].append({'by_id': actor['id'], 'by': actor['name'], 'decision': command,
                                'note': note, 'at': now(), 'attempt': task['attempt']})
        if command == 'return':
            task['status'] = 'returned'
        elif set(task['reviewer_ids']) <= {r['by_id'] for r in task['reviews'] if r['attempt'] == task['attempt'] and r['decision'] == 'approve'}:
            task['status'] = 'approved'
    else:
        raise Problem('任务操作不存在。')
    event(project, actor, {'submit': '提交任务', 'approve': '确认任务', 'return': '退回整改'}[command], task['title'] + ' · ' + note, change['id'])
    if all(t['status'] == 'approved' for t in change['tasks']):
        change['status'] = 'acceptance'


def accept(project, change, actor, payload):
    check(change['status'] == 'acceptance', '执行任务尚未全部确认完成。', 409)
    check(actor['id'] == current(change)['approvers']['owner'], '仅本项目指定住户可确认最终交付。', 403)
    note = required(payload.get('note'), '人工验收意见', 1000)
    check(payload.get('decision') in ('approve', 'return'), '请选择验收通过或退回整改。')
    if payload['decision'] == 'approve':
        change['status'] = 'closed'
    else:
        change['status'] = 'executing'
        change['tasks'][-1]['status'] = 'returned'
    event(project, actor, '人工验收通过' if change['status'] == 'closed' else '人工验收退回', note, change['id'])
