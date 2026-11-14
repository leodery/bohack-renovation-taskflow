"""Compare and approve changes to a published construction schedule."""
from copy import deepcopy
from datetime import date, timedelta

import domain as rules


def day(value):
    try:
        parsed = date.fromisoformat(value)
        rules.check(2000 <= parsed.year <= 2090, '工期日期超出支持范围。')
        return parsed
    except (ValueError, TypeError):
        raise rules.Problem('请输入有效日期。')


def finish(node):
    return day(node['start']) + timedelta(days=node['days'] - 1)


def baseline(change):
    if change.get('schedule'):
        return deepcopy(change['schedule'])
    tasks = change['tasks']
    return {'number': 1, 'nodes': [
        {'id': t['id'], 'title': t['title'], 'start': t['due'], 'days': 1,
         'crew': '', 'deps': list(t['depends_on']), 'required_deps': list(t['depends_on']),
         'optional': False, 'included': True, 'owner_id': t['owner_id']}
        for t in tasks
    ], 'inferred': True}


def seed_demo_schedule(change):
    start = day(change['published_plan']['start'])
    plan = baseline(change)
    for node, (offset, duration, crew) in zip(plan['nodes'], [
        (0, 1, '材料组'), (0, 1, '铺贴班组'), (2, 2, '铺贴班组'), (4, 1, '验收组')
    ]):
        node.update(start=(start + timedelta(days=offset)).isoformat(), days=duration, crew=crew)
    for task, node in zip(change['tasks'], plan['nodes']):
        task['due'] = finish(node).isoformat()
    plan['nodes'].append({'id': 'handoff', 'title': '现场协调碰头', 'start': start.isoformat(),
                          'days': 1, 'crew': '协调组', 'deps': [], 'required_deps': [],
                          'optional': True, 'included': True, 'owner_id': None})
    plan['inferred'] = False
    change['schedule'] = plan


def check_nodes(nodes, change):
    active = {n['id']: n for n in nodes if n['included']}
    errors = []
    def issue(message, *items):
        errors.append({'message': message, 'nodes': list(items)})
    for n in nodes:
        key = n['id']
        if not n['included']:
            if not n['optional']:
                issue('不可删减必需节点「' + n['title'] + '」。', key)
            continue
        for dep in n['required_deps']:
            if dep not in n['deps']:
                title = next(x['title'] for x in nodes if x['id']==dep)
                issue(f"「{n['title']}」缺少必需前置「{title}」。请恢复依赖关系。", key, dep)
        for dep in n['deps']:
            prev = active.get(dep)
            if not prev:
                title = next(x['title'] for x in nodes if x['id']==dep)
                issue(f"「{n['title']}」缺少「{title}」。请恢复该核验节点。", key, dep)
            elif day(n['start']) <= finish(prev):
                issue(f"「{n['title']}」{n['start']} 开始，但「{prev['title']}」{finish(prev)} 才完成。请推迟后续工序，或核实前置条件能否提前完成。",
                      key, dep)
    for crew in sorted({n['crew'] for n in active.values() if n['crew']}):
        jobs = sorted((n for n in active.values() if n['crew'] == crew), key=lambda n: n['start'])
        for i, a in enumerate(jobs):
            for b in jobs[i+1:]:
                if day(b['start']) <= finish(a):
                    issue(f"班组「{crew}」在「{a['title']}」和「{b['title']}」间重叠。", a['id'], b['id'])
    visiting, visited = set(), set()
    def cycle(key):
        if key in visiting:
            return True
        if key in visited or key not in active:
            return False
        visiting.add(key)
        loop = any(cycle(d) for d in active[key]['deps'])
        visiting.remove(key)
        visited.add(key)
        return loop
    if any(cycle(k) for k in active):
        issue('节点互相等待，排程存在循环依赖。')
    fields = rules.current(change)['data']
    kitchen = change.get('kitchen_change')
    if kitchen and 'materials' in active and day(active['materials']['start']) < day(kitchen['new_arrival']):
        issue(f"新砖 {kitchen['new_arrival']} 到货，材料核对须安排在到货当天或之后。", 'materials', 'installation')
    tasks = {t['id']:t for t in change['tasks']}
    today = day(rules.now()[:10])
    original = {n['id']:n for n in baseline(change)['nodes']}
    for n in active.values():
        task = tasks.get(n['id'])
        moved = n['start'] != original[n['id']]['start']
        if moved and task and task['status'] in ('ready', 'returned') and day(n['start']) < today:
            issue(f"「{n['title']}」调整后的开始日期已过去。", n['id'])
    for key, field in [('materials', 'arrival_date'), ('preparation', 'crew_date'),
                       ('installation', 'crew_date'), ('self_check', 'crew_date')]:
        earliest = fields.get(field)
        if key in active and earliest and day(active[key]['start']) < day(earliest):
            issue(f"「{active[key]['title']}」早于已确认的可开始日期 {earliest}。", key)
    return errors


def suggest(nodes, change):
    """List scheduling with resource availability, respecting locked dates."""
    result = deepcopy(nodes)
    old = {n['id']: n for n in baseline(change)['nodes']}
    tasks = {t['id']: t for t in change['tasks']}
    fields = rules.current(change)['data']
    horizon = max(day(change['published_plan']['start']), day(rules.now()[:10]))
    done = {}
    for n in result:
        if n['id'] in tasks and (tasks[n['id']]['status'] not in ('ready', 'returned') or tasks[n['id']].get('attempt')):
            n.update(old[n['id']])
            done[n['id']] = n
        if not n['optional']:
            n['included'] = True
        n['deps'] = list(dict.fromkeys(n['required_deps'] + n['deps']))
    active = {n['id']: n for n in result if n['included']}
    for n in active.values():
        for dep in n['deps']:
            if dep not in active:
                return None
    pending = {k: n for k,n in active.items() if k not in done}
    priorities = {n['id']: i for i,n in enumerate(nodes)}
    while pending:
        available = [n for n in pending.values() if all(d in done for d in n['deps'])]
        if not available:
            return None
        n = min(available, key=lambda x: (x['start'], priorities[x['id']]))
        bounds = [horizon] + [finish(done[d])+timedelta(days=1) for d in n['deps']]
        field = 'arrival_date' if n['id']=='materials' else 'crew_date'
        earliest = change.get('kitchen_change', {}).get('new_arrival') if n['id']=='materials' else None
        if earliest or fields.get(field):
            bounds.append(day(earliest or fields[field]))
        if n.get('earliest'):
            bounds.append(day(n['earliest']))
        start = max(bounds)
        for other in sorted(done.values(), key=lambda x:x['start']):
            if n['crew'] and n['crew']==other['crew'] and start <= finish(other) and start+timedelta(days=n['days']-1) >= day(other['start']):
                start = finish(other)+timedelta(days=1)
        n['start'] = start.isoformat()
        done[n['id']] = pending.pop(n['id'])
    return result if not check_nodes(result, change) else None


def preview(change, updates, fees):
    base = baseline(change)
    rules.check(isinstance(updates, list) and all(isinstance(x, dict) for x in updates), '节点格式错误。')
    ids = [u.get('id') for u in updates]
    rules.check(sorted(str(x) for x in ids) == sorted(n['id'] for n in base['nodes']), '请保留原节点记录，使用启用开关提出删减。')
    edits = {u['id']: u for u in updates}
    locked = {t['id'] for t in change['tasks'] if t['status'] not in ('ready','returned') or t.get('attempt')}
    nodes = deepcopy(base['nodes'])
    for n in nodes:
        u = edits[n['id']]
        deps = u.get('deps')
        rules.check(isinstance(deps,list) and all(isinstance(d,str) and d in ids and d != n['id'] for d in deps), '前置条件无效。')
        if not n['optional']:
            optional_ids = {row['id'] for row in base['nodes'] if row['optional']}
            rules.check(not optional_ids.intersection(deps), '施工任务的前置条件须为施工任务。')
        days = u.get('days')
        rules.check(type(days) is int and 1 <= days <= 365, '节点工期需为 1 到 365 天。')
        crew = u.get('crew','')
        rules.check(isinstance(crew,str) and len(crew)<=60, '班组名称过长。')
        rules.check(type(u.get('included')) is bool, '节点状态无效。')
        before = n.copy()
        n.update(start=day(u.get('start')).isoformat(), days=days, crew=crew.strip(),
                 deps=list(dict.fromkeys(deps)), included=u['included'])
        rules.check(n['id'] not in locked or n==before, f"「{n['title']}」已有交付记录，排程保持原样。", 409)
    rules.check(any(n['included'] for n in nodes), '至少保留一个排程节点。')
    rules.check(isinstance(fees,dict), '费用格式错误。')
    rates = {k:fees.get(k) for k in ('delay','idle')}
    for value in rates.values():
        rules.check(value is None or (type(value) is int and 0 <= value <= 1000000), '费率请填非负整数元或留空。')
    errors = check_nodes(nodes,change)
    alternative = suggest(nodes,change)
    initial = day(change['published_plan']['finish'])
    def metrics(items):
        end = max(finish(n) for n in items if n['included'])
        delta = (end-initial).days
        crew_days = {}
        for n in items:
            if n['included'] and n['crew']:
                crew_days.setdefault(n['crew'],set()).update(day(n['start'])+timedelta(days=i) for i in range(n['days']))
        gaps = sum((max(ds)-min(ds)).days+1-len(ds) for ds in crew_days.values())
        return {'finish':end.isoformat(),'delta':delta,'gaps':gaps,
                'delay_cost':max(0,delta)*rates['delay'] if rates['delay'] is not None else None,
                'idle_cost':gaps*rates['idle'] if rates['idle'] is not None else None}
    changed = {n['id'] for n, old in zip(nodes,base['nodes']) if n!=old}
    affected = changed | {key for i in errors for key in i['nodes']}
    while True:
        downstream = {n['id'] for n in nodes if affected.intersection(n['deps'])}
        if downstream <= affected:
            break
        affected |= downstream
    return {'base':base, 'base_metrics':metrics(base['nodes']), 'nodes':nodes, 'issues':errors, 'fees':rates,
            'locked': sorted(locked),
            'affected':[n for n in nodes if n['id'] in affected], 'metrics':metrics(nodes),
            'alternative':{'nodes':alternative,'metrics':metrics(alternative)} if alternative else None}


def locked_for_change(change, task_id):
    if change.get('kitchen_change') and not change['kitchen_change'].get('applied'):
        return task_id in ('materials','preparation','installation','self_check')
    draft = change.get('schedule_draft')
    proposals = change.get('schedule_proposals', [])
    result = draft or (proposals[-1]['result'] if proposals and proposals[-1]['status'] in ('pending','returned') else None)
    return bool(result and any(n['id']==task_id for n in result['affected']))


def handle(project, change, actor, command, payload):
    rules.check(change['status']=='executing', '仅施工中的变更可调整排程。',409)
    rules.check(project['plan'].get('change_id')==change['id'], '仅可调整当前正式施工计划。',409)
    history = change.setdefault('schedule_proposals', [])
    active = history[-1] if history else None
    version = rules.current(change)
    if command in ('save', 'propose'):
        rules.check(actor['role']=='coordinator','仅中介方可提交排程调整。',403)
        result = preview(change,payload.get('nodes'),payload.get('fees',{}))
        if command=='save':
            if active and active['status']=='pending':
                active['status']='superseded'
            change['schedule_draft']=result
            rules.event(project,actor,'保存排程草稿','保留当前正式排程。',change['id'])
            return
        rules.check(not result['issues'], '请先解决排程冲突。',409)
        rules.check(result['nodes']!=result['base']['nodes'],'请先修改至少一个节点。')
        note = rules.required(payload.get('note'),'调序原因',500)
        approvers = version['approvers'].copy()
        rules.check(all(approvers.values()),'缺少指定确认人。',409)
        if active and active['status']=='pending':
            active['status']='superseded'
        change.pop('schedule_draft',None)
        history.append({'id':rules.ident(),'status':'pending','result':result,'note':note,
                        'approvers':approvers,'decisions':{},'created_by':actor['name']})
        rules.event(project,actor,'提出排程调整',note,change['id'])
        return
    rules.check(active and active['id']==payload.get('proposal_id') and active['status']=='pending',
                '该方案已更新或结束，请刷新。',409)
    if command == 'decide':
        role = next((k for k,v in active['approvers'].items() if v==actor['id']),None)
        rules.check(role,'此确认未指派给你。',403)
        rules.check(role not in active['decisions'],'你已确认该方案。',409)
        decision = payload.get('decision')
        rules.check(decision in ('approve','return'),'请选择确认或退回。')
        note = rules.required(payload.get('note'),'确认意见',500)
        active['decisions'][role]={'decision':decision,'note':note,'by':actor['name'],'at':rules.now()}
        if decision=='return':
            active['status']='returned'
        rules.event(project,actor,'排程确认' if decision=='approve' else '排程退回',note,change['id'])
        return
    rules.check(command=='publish' and actor['role']=='coordinator','仅中介方可发布排程。',403)
    result = preview(change,active['result']['nodes'],active['result']['fees'])
    rules.check(not result['issues'],'现场状态已变化，请重新拟定排程。',409)
    rules.check(set(active['decisions'])==set(active['approvers']) and all(
        d['decision']=='approve' for d in active['decisions'].values()),'等待设计、施工和住户确认。',409)
    by_id={n['id']:n for n in result['nodes']}
    for t in change['tasks']:
        node=by_id[t['id']]
        rules.check(all(not by_id[d]['optional'] for d in node['deps']),
                    '施工前置条件只能关联施工任务。',409)
        t.update(due=finish(node).isoformat(),depends_on=node['deps'])
    change['schedule']={'number':result['base']['number']+1,'nodes':result['nodes'],'inferred':False}
    change['published_plan']['finish']=result['metrics']['finish']
    project['plan'].update(version=project['plan']['version']+1,finish_date=result['metrics']['finish'])
    active['status']='published'
    if change.get('kitchen_change'):
        change['kitchen_change']['applied']=True
        project['plan']['reference']=change['kitchen_change']['drawing']
    rules.event(project,actor,'发布调整排程',active['note'],change['id'])
