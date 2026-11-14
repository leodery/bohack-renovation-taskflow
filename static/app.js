'use strict';
const roles = {owner:'住户',coordinator:'中介方 / 产品总监',designer:'设计师',contractor:'施工团队',mediator:'外部复核人'};
const statuses = {clarifying:'澄清与确认',returned:'已退回 · 等待修订',executing:'施工执行中',acceptance:'等待住户验收',closed:'已验收关闭'};
const kinds = {design:'设计确认',construction:'施工与材料条件确认',owner:'费用与交付日期确认'};
const labels = {tile_spec:'瓷砖规格',layout:'铺贴方式',start_point:'起铺点与方向',edge_detail:'过门口收边',drawing_version:'图纸版本',method:'施工方法与现场条件',supplier:'供应商名称',quote_reference:'报价单编号',quote_scope:'本次增项报价范围（数量、规格、辅材、人工）',quote_amount:'本次增项总额（元）',quoted_at:'报价时间',valid_until:'报价有效至',arrival_date:'材料承诺到场日',crew_date:'班组最早开工日',duration_days:'施工总日历天数',parallel_days:'并行方案可追回天数',parallel_scope:'可并行工作与所需条件'};
const templateFor = c => state.project.templates[c.template_id || 'tiles'];
const fieldLabels = c => ({
  ...templateFor(c).design,
  ...Object.fromEntries(Object.entries(labels).filter(([key]) => !Object.hasOwn(state.project.templates.tiles.design, key)))
});
const state = {user:null,csrf:'',projects:[],project:null,tab:'overview',changeId:null,register:false,dirty:false,pending:false};
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp = value => value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '待确认';
const tag = (text,style='') => `<span class="tag ${style}">${esc(text)}</span>`;
const name = id => state.project?.members.find(m=>m.id===id)?.name || '待指派';
const change = () => state.project?.data.changes.find(c=>c.id===state.changeId);
const revision = c => c.versions[c.versions.length-1];
const isApproved = (c,k) => c.approvals.some(a=>a.version===revision(c).number && a.kind===k && a.decision==='approve');
let toastTimer;
function notify(message){
  const box=$('#toast'); box.textContent=message; box.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{box.hidden=true;},8500);
}
async function api(path,options={}){
  const headers={'X-CSRF-Token':state.csrf,...options.headers};
  if(options.body && !(options.body instanceof FormData)) headers['Content-Type']='application/json';
  const response=await fetch(path,{credentials:'same-origin',...options,headers});
  const result=await response.json();
  if(!response.ok){
    if(response.status===401 && !['/api/login','/api/register','/api/me'].includes(path)){state.user=null;render();}
    if(response.status===409 && result.error.includes('其他成员')) showRefresh();
    throw new Error(result.error || '请求失败，请重试。');
  }
  return result;
}
function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});}
async function busy(button,work){
  if(button?.disabled)return;
  if(button)button.disabled=true;
  try{await work();}catch(error){notify(error.message);}finally{if(button?.isConnected)button.disabled=false;}
}
function setProject(project){
  state.project=project;state.dirty=false;state.pending=false;
  if(!project.data.changes.some(c=>c.id===state.changeId))state.changeId=project.data.changes.at(-1)?.id || null;
  render();
}
async function refreshProjects(){state.projects=(await api('/api/projects')).projects;}
async function selectProject(id){
  if(!id){state.project=null;render();return;}
  setProject(await api(`/api/projects/${id}`));
}
function field(key,value,options={}){
  const type=options.type||'text';
  let inputValue=value??'';
  if(type==='datetime-local' && value){
    const date=new Date(value);const local=new Date(date-date.getTimezoneOffset()*60000);inputValue=local.toISOString().slice(0,16);
  }
  const control=options.area?`<textarea name="${key}" ${options.required?'required':''}>${esc(inputValue)}</textarea>`:
    `<input name="${key}" type="${type}" value="${esc(inputValue)}" ${options.required?'required':''} ${options.step?`step="${options.step}"`:''} ${options.min!==undefined?`min="${options.min}"`:''} maxlength="2000">`;
  return `<label class="${options.wide?'wide':''}">${esc(options.label||labels[key]||key)}${control}</label>`;
}
function peopleSelect(key,selected,role,allowEmpty=true){
  const members=state.project.members.filter(m=>!role||m.role===role);
  return `<select name="${key}">${allowEmpty?'<option value="">待指派</option>':''}${members.map(m=>`<option value="${m.id}" ${m.id===selected?'selected':''}>${esc(m.name)} · ${esc(roles[m.role])}</option>`).join('')}</select>`;
}
const demoRoles={coordinator:'创建案例和协调分工',owner:'查看方案与验收',designer:'确认图纸和设计',contractor:'执行任务和上传留痕'};

function demoRoleButtons(){
  return Object.entries(demoRoles).map(([role,description])=>`<button type="button" class="secondary" data-demo-role="${role}" ${!state.demo.ready&&role!=='coordinator'?'disabled':''}><strong>${esc(roles[role])}</strong><small>${description}</small></button>`).join('');
}

function authPage(){
  if(state.demo?.available&&!state.accountLogin&&!location.hash.startsWith('#join=')){
    const hint=state.demo.ready?'选择身份，继续同一个演示案例。':'先用中介方打开案例，再切换到其他三个身份。';
    return `<section class="demo-login card"><div class="brand">工序共识 · 演示</div><h1>选择演示身份</h1><p class="muted">${hint}</p><div class="demo-role-grid">${demoRoleButtons()}</div><button class="secondary" id="accountLogin">使用账号登录</button></section>`;
  }
  const invite=new URLSearchParams(location.hash.slice(1)).get('join');
  return `<div class="auth"><section class="auth-story"><div class="brand">工序共识</div><div><h1>每一步，<br>都有共同的依据。</h1><p>把住户的装修要求，交给需要作出决定的人。确认设计、材料与工期，再一起推进施工。</p></div><div class="auth-flow"><div>住户<small>提出要求，确认交付</small></div><div>中介方 / 产品总监<small>组织协商，协调分工</small></div><div>设计师<small>完善图纸，确认做法</small></div><div>施工团队<small>核对条件，落实交付</small></div></div></section><section class="auth-main"><div class="auth-box"><h2>${state.register?'创建你的协作账号':'回到你的项目'}</h2><p class="muted">各方使用自己的账号，共享同一份项目记录。</p>${invite?'<div class="notice">你已打开项目邀请。登录后可使用邀请码加入。</div>':''}<div class="auth-tabs"><button data-auth="login" class="${state.register?'':'active'}">登录</button><button data-auth="register" class="${state.register?'active':''}">注册</button></div><form id="authForm"><label>用户名<input name="username" autocomplete="username" minlength="3" maxlength="40" required placeholder="字母、数字或邮箱"></label>${state.register?'<label>姓名<input name="name" autocomplete="name" maxlength="40" required></label><label>你的身份<select name="role">'+Object.entries(roles).map(([r,n])=>`<option value="${r}">${n}</option>`).join('')+'</select></label>':''}<label>密码<input name="password" type="password" autocomplete="${state.register?'new-password':'current-password'}" minlength="8" maxlength="128" required></label><button type="submit">${state.register?'注册并进入':'登录'}</button></form><small>当前样板支持铺砖变更的设计、施工、材料与验收协作。</small></div></section></div>`;
}
function shell(content){
  const tabs=[['overview','项目总览'],['schedule','工期与排程'],['changes','变更协商'],['tasks','执行待办'],['members','成员与邀请'],['activity','确认与退回记录']];
  return `<div class="shell"><aside class="sidebar"><div><div class="brand">工序共识</div><small>家装四方协作</small></div><nav class="nav">${tabs.map(([id,title])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}">${title}</button>`).join('')}</nav><div class="sidebar-footer"><div><strong>${esc(state.user.name)}</strong><br><small>${esc(roles[state.user.role])}</small></div><button id="logout">退出登录</button></div></aside><div class="workspace"><header class="topbar"><select id="projectSelect" aria-label="当前项目"><option value="">创建或加入项目</option>${state.projects.map(p=>`<option value="${p.id}" ${p.id===state.project?.id?'selected':''}>${esc(p.title)}</option>`).join('')}</select><div class="row"><span class="muted">${state.project?`共享版本 ${state.project.revision}`:'项目成员受邀加入'}</span><button id="refresh" class="secondary">${state.pending?'有更新，点击刷新':'刷新'}</button></div></header><main class="content">${content}</main></div></div>`;
}
function onboarding(){
  const invite=new URLSearchParams(location.hash.slice(1)).get('join')||'';
  const demo=state.user.role==='coordinator'?`<section class="card demo-entry">
    <div><h2>先试一个完整案例</h2><p class="muted">从分区铺砖改成全屋通铺。案例已备好各方确认、施工待办和合成留痕，进去就能审核第一项任务。</p></div>
    <button id="openDemo">直接体验示例</button>
  </section>`:'';
  return `<div class="page-head"><h1>把四方带进同一个项目</h1><p class="muted">中介方创建项目并发出邀请，其余成员用邀请码加入。</p></div>${demo}<div class="grid">${state.user.role==='coordinator'?`<section class="card"><h2>创建装修项目</h2><form id="createProject" class="stack">${field('title','',{label:'项目名称',required:true})}${field('baseline','',{label:'原方案说明',area:true,required:true})}${field('reference','',{label:'原方案 / 图纸版本',required:true})}${field('finish_date','',{label:'原约定交付日（可留空）',type:'date'})}<label class="check"><input type="checkbox" name="synthetic">演示用合成案例</label><button>创建项目</button></form></section>`:''}<section class="card"><h2>加入已有项目</h2><form id="joinProject" class="stack">${field('token',invite,{label:'项目邀请码',required:true})}<small>请确认邀请对应的身份是${esc(roles[state.user.role])}。每个邀请码可使用一次。</small><button>加入项目</button></form></section></div>`;
}
function eventsView(events){
  return events.length?`<div class="events">${[...events].reverse().map(e=>`<div class="event"><strong>${esc(e.action)}</strong> · ${esc(e.actor_name)}<p>${esc(e.detail)}</p><small>${stamp(e.at)}</small></div>`).join('')}</div>`:'<p class="empty">还没有操作记录。</p>';
}
function roleChangeTodos(){
  const p=state.project;
  const rows=p.data.changes.flatMap(c=>{
    if(!c.schedule_view)return [];
    const proposal=c.schedule_proposals?.at(-1);
    const role=proposal&&Object.keys(proposal.approvers).find(k=>proposal.approvers[k]===state.user.id);
    let action;
    if(state.user.role==='coordinator'&&(c.schedule_draft||proposal?.status==='pending'||c.kitchen_change&&!c.kitchen_change.applied)){
      action=c.schedule_draft?.issues.length?'处理排程冲突':proposal?.status==='pending'?(Object.keys(proposal.decisions).length===3?'发布已确认方案':'跟进各方确认'):'检查并提交变更';
    }else if(proposal?.status==='pending'&&role&&!proposal.decisions[role]){
      action={design:'核对新版图纸',construction:'确认到货与人员档期',owner:'确认变更与费用'}[role];
    }
    return action?[`<li><button class="secondary" data-schedule-change="${c.id}">${esc(action)}</button> ${esc(p.title)} · ${esc(c.kitchen_change?'厨房墙砖变更':c.source.text)}</li>`]:[];
  });
  return rows.length?`<section class="card"><h2>我的变更待办</h2><ul>${rows.join('')}</ul></section>`:'';
}
function overview(){
  if(['owner','designer','contractor','coordinator'].includes(state.user.role))return roleHome();
  const p=state.project, tasks=p.data.changes.flatMap(c=>c.tasks);
  const my=tasks.filter(t=>t.owner_id===state.user.id && t.status!=='approved');
  return `<div class="page-head"><div class="row between"><h1>${esc(p.title)}</h1>${p.data.synthetic?tag('演示用合成数据','warn'):tag('四方共享项目')}</div><p class="muted">先确认共同依据，再把下一步交给具体的人。</p></div>${roleChangeTodos()}<div class="stats"><div class="stat"><small>参与成员</small><strong>${p.members.length}</strong></div><div class="stat"><small>待协商变更</small><strong>${p.data.changes.filter(c=>['clarifying','returned'].includes(c.status)).length}</strong></div><div class="stat"><small>我的执行待办</small><strong>${my.length}</strong></div></div><div class="grid"><section class="card"><h2>正式施工方案</h2><dl><dt>当前版本</dt><dd>v${p.data.plan.version} · ${esc(p.data.plan.reference)}</dd><dt>方案说明</dt><dd>${esc(p.data.plan.text)}</dd><dt>交付日期</dt><dd>${esc(p.data.plan.finish_date||'待确认')}</dd></dl><details class="revision"><summary>查看原方案</summary><p>${esc(p.data.original_plan.text)}</p><small>${esc(p.data.original_plan.reference)}</small></details><div class="buttons"><button data-tab="changes">进入变更协商</button><button data-tab="members" class="secondary">邀请项目成员</button></div></section><section class="card"><h2>最近发生的事</h2>${eventsView(p.data.events.slice(-4))}</section></div>`;
}
function roleHome(){
  const p=state.project, role=state.user.role;
  const current=p.data.changes.find(c=>c.id===p.data.plan.change_id)||p.data.changes.at(-1);
  const latest=p.data.changes.at(-1);
  const topic=role==='owner'?(latest||current):current;
  const context=topic?.kitchen_change;
  const proposal=topic?.schedule_proposals?.at(-1);
  const selected=proposal?.status==='pending'?proposal:null;
  const waiting=selected?Object.entries(selected.approvers).filter(([k])=>!selected.decisions[k]).map(([,id])=>name(id)):[];
  const awaiting=waiting.length?'等待 '+waiting.join('、')+' 确认':selected?'各方已确认，等待项目经理发布':'暂无待确认排程';
  const go=(tab,label)=>topic?`<button data-role-open="${tab}" data-change-id="${topic.id}">${label}</button>`:'';
  const docs=topic?p.files.filter(f=>f.change_id===topic.id&&f.kind==='drawing'):[];
  const drawing=docs.find(f=>f.reference===(context?.drawing||p.data.plan.reference));
  const docLink=drawing?`<a href="/api/files/${drawing.id}">${esc(drawing.name)}</a>`:'暂无匹配图纸附件';
  const report=topic&&role==='contractor'?`<details class="revision"><summary>上报施工问题</summary><form id="homeIssue" class="stack" data-change-id="${topic.id}"><label>现场情况<textarea name="note" placeholder="例如：材料到场与班组安排不一致" maxlength="500" required></textarea></label><button>提交问题</button></form></details>`:'';
  const issues=p.data.events.filter(e=>e.action==='协商留言'&&e.detail.startsWith('施工问题：'));
  const conflict=topic?.schedule_draft?.issues||[];
  const title={owner:'我的装修进度',coordinator:'项目协调台',designer:'设计工作台',contractor:'施工工作台'}[role];
  let content='';
  if(role==='owner'){
    const cost=topic?.refund?`预计返费 ${topic.refund.refund} 元`:context?`墙砖材料多 ${context.new_quote-context.old_quote} 元，瓦工待工费待核实`:'费用以确认版报价为准';
    content=`<section class="card"><h2>交付与费用</h2><p>当前约定交付 ${esc(p.data.plan.finish_date||'待确认')}</p>${selected?`<p>拟调整至 ${esc(selected.result.metrics.finish)}，正在确认</p>`:''}<p>${esc(cost)}</p><p>${esc(awaiting)}</p><div class="buttons">${go(context?'schedule':'changes','查看金额和依据')}</div></section>`;
  }else if(role==='coordinator'){
    content=`<section class="card"><h2>异常与协调</h2><p>${esc(awaiting)}</p>${conflict.length?`<ul>${conflict.map(i=>`<li>${esc(i.message)}</li>`).join('')}</ul>`:'<p>当前无已保存的排程冲突。</p>'}${issues.length?eventsView(issues.slice(-4)):'<p>暂无施工问题上报。</p>'}<div class="buttons">${go('schedule','检查排程与影响')}${go('changes','查看责任分派')}</div></section>`;
  }else if(role==='designer'){
    content=`<section class="card"><h2>施工图纸和设计变更</h2><p>现行图纸 ${esc(p.data.plan.reference)}${context&&!context.applied?' · 待核对新版 '+esc(context.drawing):''}</p><p>${docLink}</p><p>${esc(context?.request||topic?.source.text||'暂无变更')}</p><p>${esc(awaiting)}</p><div class="buttons">${go('changes','查看变更差异和版本')}</div></section>`;
  }else{
    const tasks=topic?.tasks.filter(t=>t.owner_id===state.user.id&&t.status!=='approved')||[];
    const available=tasks.filter(t=>!topic.schedule_task_locks?.includes(t.id)&&['ready','returned'].includes(t.status)&&t.depends_on.every(id=>topic.tasks.find(x=>x.id===id)?.status==='approved'));
    const next=available.find(t=>topic.schedule?.nodes.find(n=>n.id===t.id)?.start===new Date().toLocaleDateString('sv-SE'))||available[0]||tasks[0];
    const blocked=next&&topic.schedule_task_locks?.includes(next.id);
    const deps=next?.depends_on.map(id=>topic.tasks.find(t=>t.id===id)).filter(t=>t&&t.status!=='approved')||[];
    content=`<section class="card contractor-home"><h2>下一项施工任务</h2><h3>${esc(next?.title||'暂无我的施工任务')}</h3><p>${esc(blocked?'等待变更确认并发布':deps.length?'等待 '+deps.map(t=>t.title+'（'+name(t.owner_id)+'）').join('、'):next?.status==='submitted'?'等待 '+next.reviewer_ids.map(name).join('、')+' 核对':next?'前置条件已满足，请按排程执行':'')}</p><p>施工依据 ${esc(p.data.plan.reference)}${next?' · 截止 '+esc(next.due):''}</p>${next&&available.includes(next)?`<button data-role-open="tasks" data-change-id="${topic.id}" data-task-focus="${next.id}">拍照提交进度</button>`:''}${report}<p>${go('changes','查看施工要求')}</p></section>`;
  }
  return `<div class="page-head"><h1>${title}</h1><p class="muted">${esc(p.title)}${p.data.synthetic?' · 演示案例':''}</p></div><div class="stack">${roleChangeTodos()}${content}</div>`;
}
function changeToolbar(){
  const changes=state.project.data.changes;
  return `<div class="toolbar row between"><select id="changeSelect" aria-label="选择变更">${changes.map((c,i)=>`<option value="${c.id}" ${c.id===state.changeId?'selected':''}>变更 ${i+1} · ${esc(c.source.text.slice(0,25))}</option>`).join('')}</select><button id="print" class="secondary">打印共享协议单</button></div>`;
}
function sourceForm(){
  const quick=state.demoProfile&&state.demo?.ready?'<button type="button" data-refund-demo>打开已填好的返费示例</button>':'';

  if(state.user.role!=='owner')return quick+(state.demoProfile&&state.demo?.ready?'<button type="button" data-demo-role="owner" data-create-change="true" class="secondary">切到住户，生成变更单</button>':'');
  const options=Object.entries(state.project.templates).map(([key,t])=>`<option value="${esc(key)}">${esc(t.name)}</option>`).join('');
  return quick+`<details class="card" ${change()?.refund?'':'open'}><summary>生成变更单</summary><form id="newChange" class="stack"><label>工序模板<select name="template_id">${options}</select></label><label>改动需求<textarea name="text" required maxlength="2000" placeholder="例如：能不能先铺客厅，卧室等材料到了再做？会影响交付吗？"></textarea></label><div class="buttons"><button>生成变更单</button><button type="button" id="sample" class="secondary">填入示例</button></div></form></details>`;
}
function activeDispute(c){
  return c.disputes?.findLast(d=>d.version===revision(c).number&&!d.withdrawn_at);
}
function disputePanel(c){
  const active=activeDispute(c), waiting=c.pending_confirmation;
  const user=state.user;
  const form=(action,label,button)=>`<form id="disputeForm" data-action="${action}" class="stack"><label>${label}<textarea name="note" maxlength="1000" required></textarea></label><button>${button}</button></form>`;
  const reminder=waiting?`<p class="${waiting.overdue?'notice warn':'muted'}">${waiting.overdue?'确认已超时：':'等待确认：'}${esc(name(waiting.person))} · ${esc(kinds[waiting.kind])} · ${stamp(waiting.deadline)}</p>`:'';
  let controls='';
  if(active){
    controls=active.opinion?'<p class="notice">外部意见已记录。请修订方案并由原确认人重新确认。</p>':'<p class="notice warn">等待受邀外部复核人。中介方可在「成员与邀请」生成复核邀请。</p>';
    if(user.role==='mediator'&&!active.opinion)controls+=form('opinion','复核意见与依据','提交复核意见');
    if(user.id===active.opened_by_id&&!active.opinion)controls+=form('withdraw','撤回原因','撤回争议');
  }else if(user.role!=='mediator'&&(c.status==='returned'||waiting?.overdue)){
    controls=form('open','争议原因与待核对事项','升级争议');
  }
  const history=(c.disputes||[]).map(d=>`<details class="revision" ${d===active?'open':''}><summary>v${d.version} · ${esc(d.opened_by)} · ${d.withdrawn_at?'已撤回':d.opinion?'已有复核意见':'待复核'}</summary><p>${esc(d.reason)}</p><small>${stamp(d.opened_at)}</small>${d.opinion?`<p>${esc(d.reviewed_by)} · ${stamp(d.reviewed_at)} · ${esc(d.opinion)}</p>`:''}${d.withdrawal_reason?`<p>撤回原因：${esc(d.withdrawal_reason)}</p>`:''}</details>`).reverse().join('');
  if(!reminder&&!controls&&!history)return '';
  return `<section class="card"><h2>确认提醒与争议复核</h2>${reminder}${controls}${history}</section>`;
}
function nextSteps(c){
  if(c.refund)return '';
  if(c.status==='closed')return '<div class="notice">住户已确认验收，完整交付过程可在记录中回看。</div>';
  if(c.status==='executing')return '<div class="notice">当前版本已经确认并发布，执行人可在「执行待办」提交材料。</div>';
  if(c.status==='acceptance')return '<div class="notice">各项执行任务已确认，等待指定住户完成最终人工验收。</div>';
  if(c.status==='returned')return '<div class="notice warn">当前方案已退回。相关人员按退回意见修订，提交新版本后重新确认。</div>';
  const list=c.blockers.publish;
  return list.length?`<div class="notice warn"><strong>发布前还有 ${list.length} 项待办</strong><ul class="list">${list.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`:'<div class="notice">各方确认齐全，中介方现在可以发布执行任务。</div>';
}
function detailsForm(c){
  const dispute=activeDispute(c);
  if(!['clarifying','returned'].includes(c.status)||(dispute&&!dispute.opinion))return '';
  const r=revision(c), role=state.user.role;
  const keys=role==='designer'?Object.keys(templateFor(c).design):
    role==='contractor'?['method','supplier','quote_reference','quote_scope','quote_amount','quoted_at','valid_until','arrival_date','crew_date','duration_days','parallel_days','parallel_scope']:[];
  if(!keys.length)return '';
  const fields=keys.map(key=>field(key,r.data[key],{label:fieldLabels(c)[key],area:['method','quote_scope','parallel_scope'].includes(key),wide:['method','quote_scope','parallel_scope'].includes(key),type:['quoted_at','valid_until'].includes(key)?'datetime-local':['arrival_date','crew_date'].includes(key)?'date':['quote_amount','duration_days','parallel_days'].includes(key)?'number':'text',step:key==='quote_amount'?'0.01':'1',min:0})).join('');
  return `<section class="card"><h2>${role==='designer'?'完善设计依据':'完善材料与施工条件'}</h2><p class="muted">保存后生成新版本，各方需要针对新版重新确认。缺少的信息可留空。</p><form id="reviseFields" class="fields">${fields}${field('reason','',{label:'本次修订原因',wide:true,required:true})}<div class="buttons"><button>保存修订并提交</button></div></form></section>`;
}
function assignmentForm(c){
  const r=revision(c), dispute=activeDispute(c);
  const editable=state.user.role==='coordinator'&&['clarifying','returned'].includes(c.status)&&(!dispute||dispute.opinion);
  const approversLocked=(c.disputes||[]).some(d=>d.opinion);
  const rows=r.tasks.map(t=>`<tr><td>${esc(t.title)}<br><small>${esc(t.output)}</small></td><td>${esc(name(t.owner_id))}</td><td>${t.reviewer_ids.map(name).map(esc).join('、')||'待指派'}</td><td>${esc(t.due||'待确认')}</td><td>${t.depends_on.map(id=>r.tasks.find(x=>x.id===id)?.title).map(esc).join('、')||'发布后可并行'}</td></tr>`).join('');
  return `<section class="card"><h2>责任分派与前置条件</h2><p class="muted">每项行动都有执行人、确认人和交付物。</p>${editable?`<form id="assignForm"><div class="fields">${Object.entries(kinds).map(([kind,title])=>`<label>${title}${kind==='owner'||approversLocked?`<span>${esc(name(r.approvers[kind]))}</span><input type="hidden" name="approver_${kind}" value="${esc(r.approvers[kind]||'')}">`:peopleSelect('approver_'+kind,r.approvers[kind],{design:'designer',construction:'contractor'}[kind])}</label>`).join('')}<label>准备采用的方案<select name="scheme"><option value="sequential" ${r.data.scheme==='sequential'?'selected':''}>直接顺延</option><option value="parallel" ${r.data.scheme==='parallel'?'selected':''}>先做可并行工作</option></select></label></div>${r.tasks.map(t=>`<div class="assignment"><h3>${esc(t.title)}</h3><small>前置条件 · ${t.depends_on.map(id=>r.tasks.find(x=>x.id===id)?.title).map(esc).join('、')||'正式发布后可并行'}</small><div class="fields">${field('title_'+t.id,t.title,{label:'任务名称',required:true})}${field('output_'+t.id,t.output,{label:'交付物',required:true})}<label>执行人${peopleSelect('owner_'+t.id,t.owner_id,'contractor')}</label>${field('due_'+t.id,t.due,{label:'截止日期',type:'date'})}<div class="wide"><label>确认人（可多选）</label><div class="reviewers">${state.project.members.filter(m=>m.role!=='mediator'&&m.id!==t.owner_id).map(m=>`<label class="check"><input type="checkbox" name="reviewer_${t.id}" value="${m.id}" ${t.reviewer_ids.includes(m.id)?'checked':''}>${esc(m.name)}</label>`).join('')}</div></div></div></div>`).join('')}${field('reason','',{label:'分派或修订原因',required:true})}<div class="buttons"><button>保存分派与方案</button></div></form>`:`<div class="table-wrap"><table><thead><tr><th>任务与交付物</th><th>执行人</th><th>确认人</th><th>截止日</th><th>前置条件</th></tr></thead><tbody>${rows}</tbody></table></div>`}</section>`;
}
function approvalPanel(c){
  const r=revision(c);
  return `<section class="card"><h2>各方确认 · v${r.number}</h2>${Object.entries(kinds).map(([kind,title])=>{
    const approved=isApproved(c,kind),mine=r.approvers[kind]===state.user.id;
    const last=c.approvals.filter(a=>a.version===r.number&&a.kind===kind).at(-1);
    return `<div class="approval"><div class="row between"><strong>${title}</strong>${tag(approved?'已确认':last?.decision==='return'?'已退回':'待确认',approved?'':last?'red':'warn')}</div><p class="muted">${esc(name(r.approvers[kind]))}</p>${last?`<p>${esc(last.note)}</p><small>${stamp(last.at)}</small>`:''}${mine&&!approved&&c.status==='clarifying'&&!activeDispute(c)?`<form data-approve="${kind}"><label>确认意见或退回原因<textarea name="note" required maxlength="1000"></textarea></label>${c.blockers[kind].length?`<small>${c.blockers[kind].map(esc).join('；')}</small>`:''}<div class="row"><button value="approve" ${c.blockers[kind].length?'disabled':''}>确认通过</button><button value="return" class="danger">退回修订</button></div></form>`:''}</div>`;
  }).join('')}${!c.refund&&state.user.role==='coordinator'&&c.status==='clarifying'?`<div class="buttons"><button id="publish" ${c.blockers.publish.length?'disabled':''}>发布正式任务与排期</button></div>`:''}</section>`;
}
function planPanel(c){
  const r=revision(c),d=r.data,rec=c.recommendation||{};
  const reco=`<div class="reco"><h3>施工方案推荐 · ${esc(rec.title||'待计算')}</h3><ul>${(rec.reasons||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${(rec.cautions||[]).length?`<div class="caution">前提与风险：${rec.cautions.map(esc).join('；')}</div>`:''}<small>推荐仅供参考，不自动执行；最终由中介方在「责任分派」中选择，并经设计、施工、住户三方确认后才能发布。</small></div>`;
  return `<section class="card"><h2>工期方案与报价</h2>${reco}<div class="stack">${[['sequential','直接顺延'],['parallel','先做可并行工作']].map(([key,title])=>{const p=c.plans[key];return `<div><div class="row between"><strong>${title}</strong>${r.data.scheme===key?tag('当前选择'):''}${rec.recommended===key?tag('推荐'):''}</div><p>${p?`${p.start} 开始 → ${p.finish} 预计交付`:'待确认 · 需要到货日、班组安排及工期输入'}</p>${key==='parallel'?`<small>${esc(d.parallel_scope||'需要施工方提供可并行工作与可追回天数')}</small>`:''}</div>`;}).join('')}<small>按施工方填写的日历天数估算，计算结果随确认版本保存。</small><dl><dt>本次增项总额</dt><dd>${d.quote_amount===null?'待询价':esc(d.quote_amount)+' 元'}</dd><dt>供应商</dt><dd>${esc(d.supplier||'待确认')}</dd><dt>报价范围</dt><dd>${esc(d.quote_scope||'待确认')}</dd><dt>报价单编号</dt><dd>${esc(d.quote_reference||'待确认')}</dd><dt>有效至</dt><dd>${stamp(d.valid_until)}${d.valid_until&&new Date(d.valid_until)<new Date()?tag('已过期','red'):''}</dd></dl></div></section>`;
}
function isPhoto(name){return /\.(png|jpe?g)$/i.test(name||'');}
function photoStrip(files){
  const photos=files.filter(f=>f.kind==='site'&&isPhoto(f.name));
  return photos.length?`<h3>现场留痕照片</h3><div class="photo-grid">${photos.map(f=>`<div class="photo-card"><a href="/api/files/${f.id}" target="_blank" rel="noopener"><img src="/api/files/${f.id}/preview" alt="${esc(f.name)}"></a><div class="cap">${esc(f.reference||f.name)}<small>v${f.version} · ${esc(f.uploaded_by)}</small></div></div>`).join('')}</div>`:'';
}
function filePanel(c){
  const role=state.user.role, cats=[], siteMode=c.status==='executing'&&role==='contractor';
  if(c.status==='clarifying'){
    if(role==='designer')cats.push(['drawing','设计图纸']);
    if(['coordinator','contractor'].includes(role))cats.push(['quote','供应商报价依据']);
  }
  if(siteMode)cats.push(['site','施工留痕照片 / 证据']);
  const files=state.project.files.filter(f=>f.change_id===c.id);
  const list=files.map(f=>`<div class="file-row"><div class="with-thumb">${isPhoto(f.name)?`<img class="thumb" src="/api/files/${f.id}/preview" alt="">`:''}<div><a href="/api/files/${f.id}">${esc(f.name)}</a><br><small>${esc(f.reference)} · 上传于 v${f.version} · ${esc(f.uploaded_by)}</small></div></div><small>${Math.ceil(f.size/1024)} KB</small></div>`).join('');
  const standardOptions=siteMode?`<label>对应留痕标准<select name="evidenceKey" required><option value="">请选择标准</option>${templateFor(c).evidence.map(s=>`<option value="${s.key}">${s.key} · ${esc(s.label)}</option>`).join('')}</select></label>`:'';
  return `<section class="card"><h2>图纸、报价与现场留痕</h2>${photoStrip(files)}${files.length?list:'<p class="muted">等待成员上传图纸、报价或现场记录。</p>'}${cats.length?`<form id="uploadForm" class="stack"><label>用途<select name="kind">${cats.map(([k,n])=>`<option value="${k}">${esc(n)}</option>`).join('')}</select></label>${standardOptions}${field('reference','',{label:siteMode?'照片说明（拍的是什么、哪个位置）':'图纸版本 / 报价单编号（与方案字段一致）',required:true})}<label>选择文件<input type="file" name="file" accept=".png,.jpg,.jpeg,.pdf,.txt,.docx" ${siteMode?'capture="environmental"':''} required></label><small>${siteMode?'建议现场直接拍照上传：每张照片对应一条留痕标准。照片只用于演示留痕，施工结果以人工验收为准。':'单文件最多 8 MB。上传设计或报价材料前，请先完成对应字段修订。'}</small><button>上传并留存记录</button></form>`:''}${evidencePanel(c)}</section>`;
}
function evidencePanel(c){
  const report=c.evidence_reports?.at(-1), r=revision(c);
  const stale=report&&report.standards_version!==r.number;
  let body='';
  if(report&&report.summary){
    const s=report.summary;
    body=`<div class="evidence-stats">
      <div class="ebox"><strong>${s.total}</strong><small>预设标准</small></div>
      <div class="ebox ok"><strong>${s.compliant}</strong><small>已配齐</small></div>
      <div class="ebox miss"><strong>${s.missing}</strong><small>缺失</small></div>
      <div class="ebox bad"><strong>${s.noncompliant}</strong><small>资料有误</small></div>
    </div>
    <div class="notice ${stale?'warn':''}"><strong>附件齐备检查</strong><br>按标准编号、文件类型与方案版本核对附件。现场照片的拍摄时间、角度与画面内容，请查看「执行待办」中的照片初审。<br><small>${esc(report.label)} · 核对 v${report.standards_version} · ${stamp(report.at)}${stale?' · 方案已有更新，请重新核对':''}</small></div>
    <h3>逐条核对 · ${s.total} 条留痕标准</h3>
    ${report.standards.map(i=>`<div class="std-row"><span class="std-badge ${i.status}">${esc(i.key)} · ${{compliant:'已配齐',missing:'缺失',noncompliant:'资料有误'}[i.status]}</span><div class="std-main"><strong>${esc(i.label)}</strong><small>${esc(i.status==='compliant'?'附件格式和编号已齐备。请查看对应任务的逐项照片初审。':i.reason)}</small><small>依据：${esc(i.basis)}</small>${i.file&&isPhoto(i.file.name)?`<a href="/api/files/${i.file.id}" target="_blank" rel="noopener"><img class="thumb" src="/api/files/${i.file.id}/preview" alt=""></a>`:''}</div></div>`).join('')}
    <small>${esc(report.disclaimer)}</small>`;
  }else if(report){
    body=`<p>${esc(report.missing.length?'待补：'+report.missing.join('、'):'三类资料均已上传。')}</p>`;
  }
  const notes=(report?.findings||[]).map(f=>`<li><strong>${esc(f.file)}</strong> · 「${esc(f.evidence)}」<br>${esc(f.message)}</li>`).join('')
    +(report?.model_notes||[]).map(n=>`<li><strong>${esc(n.file)}</strong> · 「${esc(n.evidence)}」<br>${esc(n.note)}</li>`).join('');
  return `<div class="evidence-check"><h3>附件齐备检查</h3><p class="muted">按每道工序要求核对附件是否齐全。画面判断显示在对应任务的照片下方。</p><div class="buttons"><button id="checkEvidence" class="secondary">检查附件清单</button></div>${body}${notes?`<h3>需人工复核的文字依据</h3><ul class="list">${notes}</ul>`:''}${report?`<p class="muted">三类资料核对：${esc(report.missing.length?report.missing.join('、'):'图纸、报价、交付记录均已上传')}。已读取文字：${esc((report.read_files||[]).join('、')||'没有可读取的 TXT 文件')}。</p><small>资料齐备不代表施工合格；审批、确认与验收仍由各方人工完成。</small>`:''}</div>`;
}
function responsibilityTable(tasks){
  return `<div class="table-wrap"><table><thead><tr><th>任务 / 交付物</th><th>执行人</th><th>确认人</th><th>截止日</th><th>前置条件</th></tr></thead><tbody>${tasks.map(t=>`<tr><td>${esc(t.title)}<br>${esc(t.output)}</td><td>${esc(name(t.owner_id))}</td><td>${t.reviewer_ids.map(name).map(esc).join('、')||'待指派'}</td><td>${esc(t.due||'待确认')}</td><td>${t.depends_on.map(id=>tasks.find(x=>x.id===id)?.title).map(esc).join('、')||'发布后可并行'}</td></tr>`).join('')}</tbody></table></div>`;
}
function protocol(c){
  const r=revision(c), p=state.project;
  return `<article class="print-protocol"><h1>工序共识 · 共享协议单</h1><p>${esc(p.title)} · 变更 ${esc(c.id)} · v${r.number} · ${esc(statuses[c.status])}</p><small>导出时间 ${stamp(new Date().toISOString())}${p.data.synthetic?' · 演示用合成案例':''}</small><h2>原始要求与共同依据</h2><p>${esc(c.source.author_name)} · ${stamp(c.source.at)}</p><p>${esc(c.source.text)}</p><p>提出时原方案：${esc((c.original_baseline||c.baseline).reference)} · ${esc((c.original_baseline||c.baseline).text)}</p><p>本版基于正式方案 v${c.baseline.version} · ${esc(c.baseline.reference)}</p><dl>${Object.entries(fieldLabels(c)).map(([key,label])=>`<dt>${esc(label)}</dt><dd>${esc(r.data[key]??'待确认')}</dd>`).join('')}</dl><h2>工期与责任分派</h2><p>选定方案：${r.data.scheme==='parallel'?'先做可并行工作':'直接顺延'} · ${c.plans[r.data.scheme]?esc(c.plans[r.data.scheme].start)+' 至 '+esc(c.plans[r.data.scheme].finish):'日期待确认'}</p>${responsibilityTable(r.tasks)}<h2>历次确认与退回</h2>${c.approvals.map(a=>`<p>v${a.version} · ${esc(kinds[a.kind])} · ${esc(a.actor_name)} · ${a.decision==='approve'?'通过':'退回'} · ${stamp(a.at)}<br>${esc(a.note)}</p>`).join('')||'<p>尚无确认记录</p>'}<h2>已上传资料</h2>${p.files.filter(f=>f.change_id===c.id).map(f=>`<p>${esc(f.name)} · ${esc(f.reference)} · 上传于 v${f.version} · ${esc(f.uploaded_by)}</p>`).join('')||'<p>尚无资料</p>'}<h2>完整过程记录</h2>${eventsView(p.data.events.filter(e=>e.change_id===c.id))}<p>此单汇集项目内确认记录；施工结果以人工验收记录为准。</p></article>`;
}
function versionHistory(c){
  const original=c.original_baseline||c.baseline;
  const versions=c.versions.map((v,index)=>{
    const previous=c.versions[index-1];
    const values=Object.entries(fieldLabels(c)).flatMap(([key,label])=>{
      const before=previous?.data[key]??null, after=v.data[key]??null;
      return before===after?[]:[`<li><strong>${esc(label)}</strong>：${esc(before??'待确认')} → ${esc(after??'待确认')}</li>`];
    });
    const tasks=previous?v.tasks.flatMap(t=>{
      const old=previous.tasks.find(item=>item.id===t.id);
      if(!old)return [];
      const diffs=[];
      if(old.title!==t.title)diffs.push(`名称 ${old.title} → ${t.title}`);
      if(old.output!==t.output)diffs.push(`交付物 ${old.output} → ${t.output}`);
      if(old.owner_id!==t.owner_id)diffs.push(`执行人 ${name(old.owner_id)} → ${name(t.owner_id)}`);
      if(old.due!==t.due)diffs.push(`截止日 ${old.due||'待定'} → ${t.due||'待定'}`);
      if(JSON.stringify(old.reviewer_ids)!==JSON.stringify(t.reviewer_ids))diffs.push(`确认人 ${old.reviewer_ids.map(name).join('、')||'待定'} → ${t.reviewer_ids.map(name).join('、')||'待定'}`);
      return diffs.length?[`<li><strong>${esc(t.title)}</strong>：${esc(diffs.join('；'))}</li>`]:[];
    }):[];
    const approvers=previous?Object.entries(v.approvers).filter(([key,id])=>previous.approvers[key]!==id).map(([key,id])=>`<li><strong>${esc(kinds[key])}确认人</strong>：${esc(name(previous.approvers[key]))} → ${esc(name(id))}</li>`):[];
    const decisions=c.approvals.filter(a=>a.version===v.number);
    const changes=[...values,...tasks,...approvers];
    return `<details class="revision version-diff" ${index===0||index===c.versions.length-1?'open':''}><summary>v${v.number} · ${esc(v.reason)}</summary><p><small>${esc(v.by)} · ${stamp(v.at)}</small></p>${previous?changes.length?`<ul>${changes.join('')}</ul>`:'<p>本版未录入字段或任务变动，请查看修订原因。</p>':`<p>住户提出变更，原方案仍为 ${esc(original.reference)}，设计、报价与工期进入协商。</p>`}${decisions.length?`<p><strong>本版确认记录</strong></p><ul>${decisions.map(a=>`<li>${esc(a.actor_name)} · ${esc(kinds[a.kind])} · ${a.decision==='approve'?'确认':'退回'}：${esc(a.note)}</li>`).join('')}</ul>`:''}</details>`;
  }).join('');
  const timeline=state.project.data.events.filter(e=>e.change_id===c.id).slice(-12).map(e=>e.action==='生成演示初审'&&state.project.data.synthetic?{...e,action:'检查演示附件',detail:'3 项附件已配齐、1 项缺失、1 项资料有误。'}:e);
  return `<section class="card"><h2>协商与版本记录</h2><div class="notice version-origin"><p><strong>原装修约定 · ${esc(original.reference)}</strong></p><p>${esc(original.text)}</p>${original.finish_date?`<p>原约定交付日 ${esc(original.finish_date)}</p>`:''}<p><strong>住户变更原话</strong></p><blockquote>${esc(c.source.text)}</blockquote></div>${versions}${timeline.length?`<details class="revision"><summary>最近操作记录</summary>${eventsView(timeline)}</details>`:''}<details class="revision"><summary>补充说明</summary><form id="commentForm" class="stack"><label>补充问题或说明<textarea name="text" required maxlength="2000"></textarea></label><button>发送到本项目</button></form></details></section>`;
}
function refundSummary(c){
  if(!c.refund)return '';
  const f=c.refund;
  const confirmed=isApproved(c,'owner');
  return `<section class="card"><h2>住户变更返费方案</h2><p><strong>变更前：</strong>客厅和卧室全屋通铺。增项已付 ${f.paid} 元。</p><p><strong>变更后：</strong>只做客厅，卧室取消本次增项。</p><p>保留费用 ${f.retained} 元 · 取消扣费 ${f.deduction} 元 · <strong>预计返费 ${f.refund} 元</strong></p><p class="muted">${esc(f.basis)}</p><p>新方案预计交付 <strong>${esc(c.plans.sequential?.finish||'待核对')}</strong>。${confirmed?'住户已确认方案。':'设计与施工已核对，待住户确认。'}</p><small>演示金额。确认仅记录方案意见。</small></section>`;
}
function changesPage(){
  const c=change();
  if(!c)return `<div class="page-head"><h1>变更协商</h1><p class="muted">住户提出要求后，各方围绕同一份方案补充信息、确认分工。</p></div>${sourceForm()}${state.user.role!=='owner'?'<div class="card empty">等待住户提出要求。请先邀请四方成员加入项目。</div>':''}`;
  const r=revision(c),a=r.analysis;
  const progress=['clarifying','executing','acceptance','closed'];
  const facts=a.facts.map(f=>`<li>${esc(labels[f.field]||f.field)} · ${esc(f.value)}<br><small>原文依据「${esc(f.evidence)}」</small></li>`).join('');
  return `<div class="page-head"><h1>变更协商</h1><p class="muted">查看当前方案、确认进度和变更记录。</p></div>${changeToolbar()}<div class="stack">${refundSummary(c)}<section class="card"><div class="row between"><h2>${esc(templateFor(c).name)} · v${r.number}</h2>${tag(statuses[c.status],c.status==='returned'?'red':'')}</div><p class="source">${esc(c.source.text)}</p><small>住户 ${esc(c.source.author_name)} · ${stamp(c.source.at)} · 原方案 ${esc((c.original_baseline||c.baseline).reference)}</small><div class="phase">${progress.map(key=>`<span class="${c.status===key || key==='clarifying'&&c.status==='returned'?'active':''}">${statuses[key]}</span>`).join('')}</div></section><div class="change-grid"><div class="stack"><section class="card"><h2>事实与待确认事项</h2>${tag(a.label,'neutral')}${facts?`<ul class="list">${facts}</ul>`:'<p class="muted">原话中的明确事实由各方继续核对。</p>'}<ul class="list">${a.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><details class="revision"><summary>当前设计与施工依据</summary><dl>${Object.entries(fieldLabels(c)).map(([key,label])=>`<dt>${esc(label)}</dt><dd>${esc(r.data[key]??'待确认')}</dd>`).join('')}</dl></details></section>${c.refund?'':detailsForm(c)+assignmentForm(c)}${sourceForm()}${versionHistory(c)}</div><div class="stack">${nextSteps(c)}${disputePanel(c)}${approvalPanel(c)}${planPanel(c)}${filePanel(c)}</div></div></div>`;
}
const photoStatuses={pass:'未发现疑点',fail:'发现疑点',uncertain:'待复核'};
const photoAxes=[['time','拍摄时间'],['angle','拍摄角度'],['content','画面内容']];

function photoReviewQueue(c){
  const viewer=state.user.id;
  const finalReview=c.status==='acceptance'&&revision(c).approvers.owner===viewer;
  const tasks=c.tasks.filter(t=>finalReview||(t.status==='submitted'&&t.reviewer_ids.includes(viewer)&&
      !t.reviews.some(r=>r.by_id===viewer&&r.attempt===t.attempt)));
  if(!tasks.length)return '';
  const files=new Map(state.project.files.map(f=>[f.id,f]));
  const groups=tasks.map(task=>{
    const submission=task.submissions.at(-1);
    const rows=(submission?.files||[]).map(id=>{
      const file=files.get(id);
      const flags=file?.photo_review?photoAxes.flatMap(([key,label])=>{
        const item=file.photo_review[key];
        return item?.status==='pass'?[]:[{label,status:item?.status||'uncertain',reason:item?.reason||'缺少此项结果。',evidence:item?.evidence}];
      }):[{label:'未做照片初审',status:'uncertain',reason:'请查看原附件。'}];
      return {file,flags};
    });
    return {task,rows};
  });
  const rows=groups.flatMap(g=>g.rows);
  const flagged=rows.filter(r=>r.flags.length).length;
  return `<section class="card photo-review-queue"><h2>人工复核清单</h2><p class="muted">当前提交共 ${rows.length} 份附件，${flagged} 份有疑点或缺少初审。清单帮助你优先核对这些附件，确认或退回由你填写。</p>
  ${groups.map(({task,rows})=>`<div class="review-queue-group"><div class="row between"><strong>${esc(task.title)}</strong><a href="#review-task-${esc(task.id)}" data-review-task="${esc(task.id)}">定位任务</a></div>
    ${rows.filter(r=>r.flags.length).map(({file,flags})=>`<div class="review-queue-item"><strong>${esc(file?.name||'附件不可用')}</strong>${file?` · <a href="/api/files/${file.id}${isPhoto(file.name)?'/preview':''}" target="_blank" rel="noopener">查看原件</a>`:''}<ul>${flags.map(f=>`<li><strong>${esc(f.label)} · ${esc(photoStatuses[f.status])}</strong> ${esc(f.reason)}${f.evidence?`<small>依据：${esc(f.evidence)}</small>`:''}</li>`).join('')}</ul></div>`).join('')}
    ${rows.some(r=>!r.flags.length)?`<details><summary>初审未发现疑点（${rows.filter(r=>!r.flags.length).length} 份）</summary>${rows.filter(r=>!r.flags.length).map(({file})=>`<p><a href="/api/files/${file.id}/preview" target="_blank" rel="noopener">${esc(file.name)}</a></p>`).join('')}</details>`:''}</div>`).join('')}</section>`;
}
function reviewedPhoto(file){
  const r=file.photo_review;
  if(!r)return `<p><a href="/api/files/${file.id}">${esc(file.name)}</a><br><small>历史留痕 · 未做逐项照片初审</small></p>`;
  const rows=[['T · 时间',r.time,'项目规则：上传前 24 小时内，设备时钟容差 5 分钟'],['A · 拍摄角度',r.angle,r.angle_requirement],['C · 画面内容',r.content,r.content_requirement]];
  return `<div class="photo-evaluation"><a href="/api/files/${file.id}"><img src="/api/files/${file.id}/preview" alt="${esc(file.name)}"></a><div><strong>${esc(file.reference)}</strong><small> · ${esc(file.name)}</small><p><small>拍摄：${r.time.captured_at?stamp(r.time.captured_at):'原图未提供可读时间'} · 上传：${stamp(r.time.uploaded_at)}${r.time.gap_seconds!==null?' · 相差 '+Math.round(r.time.gap_seconds/60)+' 分钟':''}</small></p>${r.time.timezone_note?`<small>${esc(r.time.timezone_note)}</small>`:''}<ul class="photo-checks">${rows.map(([label,item,rule])=>`<li><strong>${label} · ${photoStatuses[item.status]}</strong><small>要求：${esc(rule)}</small><p>${esc(item.reason)}</p>${item.evidence?`<small>可见依据：${esc(item.evidence)}</small>`:''}</li>`).join('')}</ul><small>${r.mode==='model'?'视觉初审 · '+esc(r.model):'视觉项待人工复核'} · 审核意见由确认人填写。</small></div></div>`;
}
function taskPhotoUpload(c,t){
  const template=templateFor(c);
  const standards=template.evidence.filter(s=>template.task_standards?.[t.id]?.includes(s.key));
  if(!standards.length)return '';
  return `<form class="stack task-photo-form" data-photo-task="${esc(t.id)}"><h3>上传现场照片</h3><label>拍摄标准<select name="standard">${standards.map(s=>`<option value="${esc(s.key)}">${esc(s.key)} · ${esc(s.label)}</option>`).join('')}</select></label><div class="notice photo-criteria"></div><label>部位与说明<input name="note" placeholder="例如：客厅入户门，材料包装标签近照" maxlength="85" required></label><label>拍照或选原图<input name="file" type="file" accept="image/jpeg,image/png" capture="environment" required></label><small>JPG / PNG，8 MB 以内。尽量使用相机原图，保留拍摄时间。</small><button>上传并初审</button></form>`;
}
function tasksPage(){
  const c=change();
  if(!c)return '<div class="card empty">请先进入变更协商，完成方案确认。</div>';
  return `<div class="page-head"><h1>执行待办</h1><p class="muted">任务交付材料经指定人员确认后，后续工作才能继续。</p></div>${changeToolbar()}${photoReviewQueue(c)}${!c.tasks.length?`<div class="card">${nextSteps(c)}</div>`:`<div class="change-grid"><div class="stack">${c.tasks.map(t=>{
    const blocked=t.depends_on.filter(id=>c.tasks.find(x=>x.id===id)?.status!=='approved');
    const mine=t.owner_id===state.user.id;
    const review=t.reviewer_ids.includes(state.user.id)&&!t.reviews.some(r=>r.by_id===state.user.id&&r.attempt===t.attempt);
    const files=state.project.files.filter(f=>f.change_id===c.id&&f.kind==='site'&&(!f.task_id||f.task_id===t.id));
    const locked=c.schedule_task_locks?.includes(t.id);
    const canUpload=!locked&&mine&&!blocked.length&&['ready','returned'].includes(t.status)&&c.status==='executing';
    const taskPhotos=files.filter(f=>f.task_id===t.id&&f.photo_review);
    const taskStatus={ready:blocked.length?'等待前置确认':'可开始',submitted:'等待确认',returned:'退回整改',approved:'已确认完成'}[t.status];
    return `<section class="card task ${t.status}" id="review-task-${esc(t.id)}"><div class="row between"><h2>${esc(t.title)}</h2>${tag(taskStatus,t.status==='returned'?'red':'')}</div><p class="muted">执行人 ${esc(name(t.owner_id))} · 确认人 ${t.reviewer_ids.map(name).map(esc).join('、')} · 截止 ${esc(t.due)}</p><p class="details">交付物 · ${esc(t.output)}</p>${blocked.length?`<div class="notice warn">等待 ${blocked.map(id=>c.tasks.find(x=>x.id===id)?.title).map(esc).join('、')}</div>`:''}${locked?'<p class="notice">等待变更确认并发布</p>':''}${canUpload?taskPhotoUpload(c,t):''}${taskPhotos.length?`<details class="revision"><summary>查看逐张照片初审（${taskPhotos.length} 张）</summary>${taskPhotos.map(reviewedPhoto).join('')}</details>`:''}${t.submissions.map(s=>`<details class="revision"><summary>第 ${s.attempt} 次提交 · ${esc(s.by)}</summary><p>${esc(s.note)}</p><small>${stamp(s.at)}</small>${s.files.map(id=>`<p><a href="/api/files/${id}">${esc(state.project.files.find(f=>f.id===id)?.name||'查看证据')}</a></p>`).join('')}${t.reviews.filter(r=>r.attempt===s.attempt).map(r=>`<p>${esc(r.by)} · ${r.decision==='approve'?'确认通过':'退回整改'} · ${esc(r.note)}</p>`).join('')}</details>`).join('')}${canUpload?`<form data-task="${t.id}" class="stack"><label>完成情况<textarea name="note" required></textarea></label><div><label>关联已上传的施工留痕（照片可直接查看）</label>${files.length?files.map(f=>`<label class="check"><input type="checkbox" name="file_ids" value="${f.id}">${isPhoto(f.name)?`<img class="thumb" src="/api/files/${f.id}/preview" alt="">`:''}${esc(f.name)} · ${esc(f.reference||'')}</label>`).join(''):'<p class="muted">请先在本任务上传现场照片。</p>'}</div><button value="submit" ${files.length?'':'disabled'}>提交给确认人</button></form>`:''}${review&&t.status==='submitted'&&c.status==='executing'?`<form data-task="${t.id}" class="stack"><label>确认意见 / 退回原因<textarea name="note" required></textarea></label><div class="row"><button value="approve">确认本任务完成</button><button value="return" class="danger">退回整改</button></div></form>`:''}</section>`;
  }).join('')}${c.status==='acceptance'?`<section class="card"><h2>最终人工验收</h2><p>请核对交付结果与已确认方案，并记录验收结论。</p>${revision(c).approvers.owner===state.user.id?'<form id="acceptForm" class="stack"><label>验收意见<textarea name="note" required></textarea></label><div class="row"><button value="approve">验收通过并关闭</button><button value="return" class="danger">退回整改</button></div></form>':`<p class="muted">等待 ${esc(name(revision(c).approvers.owner))} 确认。</p>`}</section>`:''}${c.status==='closed'?'<div class="notice">住户已确认本次交付。</div>':''}</div><div class="stack">${filePanel(c)}<section class="card"><h2>本次执行记录</h2>${eventsView(state.project.data.events.filter(e=>e.change_id===c.id).slice(-8))}</section></div></div>`}`;
}
function membersPage(){
  return `<div class="page-head"><h1>成员与邀请</h1><p class="muted">邀请成员以各自身份加入，再把任务分派给具体的人。</p></div><div class="grid"><section class="card"><h2>项目参与方</h2>${state.project.members.map(m=>`<div class="file-row"><div><strong>${esc(m.name)}</strong><br><small>${esc(m.username)}</small></div>${tag(roles[m.role])}</div>`).join('')}</section>${state.user.role==='coordinator'?`<section class="card"><h2>邀请新成员</h2><form id="inviteForm" class="stack"><label>受邀身份<select name="role">${Object.entries(roles).map(([r,n])=>`<option value="${r}">${n}</option>`).join('')}</select></label><small>邀请三天内有效，可使用一次。</small><button>生成邀请</button></form><div id="inviteResult"></div></section>`:''}</div>`;
}
function demoBrief(c){
  const project=state.project;
  if(!project.data.synthetic||!project.data.demo_creator_id||c.template_id!=='tiles'||c.id!==project.data.changes[0]?.id)return '';
  const original=c.original_baseline||project.data.original_plan;
  const originalRequest=c.source.text;
  const legacyRequest='客厅和卧室从分区铺砖改成全屋通铺，选用 800×800 瓷砖。';
  const request=originalRequest===legacyRequest?'客厅和卧室的砖能不能连着铺？我想改成全屋通铺，换 800×800 的砖。会多花多少钱？原来约好的交付日还能赶上吗？':originalRequest;
  return `<section class="card demo-brief"><div class="row between"><h2>演示案例 · 和光里全屋通铺</h2>${tag('合成案例','warn')}</div><div class="grid"><article><h3>原装修约定 · ${esc(original.reference)}</h3><p>${esc(original.text)}</p>${original.finish_date?`<p>原约定交付 <strong>${esc(original.finish_date)}</strong></p>`:''}</article><article><h3>${request===originalRequest?'住户变更原话':'住户变更 · 路演口播稿'}</h3><blockquote>${esc(request)}</blockquote><p>已确认的演示增项 <strong>${esc(revision(c).data.quote_amount)} 元</strong></p></article></div><p><strong>接下来要解决的问题</strong> 原计划先复核基层，再铺砖。现场班组已经到场，却等不到设计师、项目经理和住户确认能否调序。为了避免当场窝工，有人先排了铺砖。这与基层复核撞班组，也可能把本来能在开铺前发现的问题拖到返工时。</p><div class="buttons"><button type="button" data-tab="changes" class="secondary">查看变更与各方确认</button>${state.user.role==='coordinator'&&c.status==='executing'?'<button type="button" id="briefScheduleDemo">检查错排草案</button>':''}</div></section>`;
}
function kitchenImpact(c,result){
  const k=c.kitchen_change;
  if(!k)return '';
  const plan=result?.nodes||c.schedule_view.base.nodes;
  const base=result?.base.nodes||c.schedule_view.base.nodes;
  const diff=(node,other)=>Math.round((Date.parse(node.start)-Date.parse(other.start))/86400000);
  const timing=plan.filter(n=>n.included).map(n=>{
    const old=base.find(x=>x.id===n.id);
    const days=diff(n,old);
    const reason=n.id==='handoff'&&days<0?'独立保护工序，可考虑提前':days>0&&['materials','installation','self_check'].includes(n.id)?'等待新砖到货或上游工序完成':days?'按草案调整':'保持原安排';
    return `<li>${esc(n.title)} · ${esc(old.start)} → ${esc(n.start)} · ${days>0?'+':''}${days} 天 · ${reason}</li>`;
  }).join('');
  const quote=state.project.files.find(f=>f.change_id===c.id&&f.reference===k.quote_reference);
  return `<section class="card"><h2>厨房墙砖变更 · 影响对比</h2><p>${esc(k.request)} 新砖调整至 ${esc(k.new_arrival)} 到货。</p><h3>关键工序 · 原开始日与拟议开始日</h3><ul>${timing}</ul><h3>费用与核实人</h3><p>同范围材料报价 ${k.old_quote} → ${k.new_quote} 元，差额 <strong>+${k.new_quote-k.old_quote} 元</strong>。${quote?`<a href="/api/files/${quote.id}">报价 ${esc(k.quote_reference)}</a>`:''}</p><p>瓦工待工费 <strong>待核实</strong> · ${esc(name(k.cost_owner))}</p><p>建议：${esc(k.advice)} 原文依据「${esc(k.evidence)}」。</p><h3>下一步</h3><p>设计师 ${esc(name(k.drawing_owner))} 核对 D03 图纸，施工方确认到货和人员档期，住户确认费用。确认状态见排程提案。</p></section>`;
}
function schedulePage(){
  const c=change();
  if(!c?.schedule_view)return '<section class="card empty">发布施工计划后，可在这里检查工序并比较调整方案。</section>';
  const view=c.schedule_view;
  const draft=state.scheduleDraft?.changeId===c.id&&state.scheduleDraft.revision===state.project.revision?state.scheduleDraft.result:(c.schedule_draft||null);
  const proposal=c.schedule_proposals?.at(-1);
  const pending=proposal?.status==='pending';
  const myRole=pending?Object.keys(proposal.approvers).find(k=>proposal.approvers[k]===state.user.id):null;
  const coordinator=state.user.role==='coordinator';
  const editable=coordinator&&c.status==='executing'&&state.project.data.plan.change_id===c.id;
  const rows=draft?.nodes||view.base.nodes;
  const delta=m=>m.delta===0?'与当前交付日相同':`${Math.abs(m.delta)} 天${m.delta>0?'延后':'提前'}`;
  const amount=v=>v==null?'未估算':`${v.toLocaleString('zh-CN')} 元`;
  const metrics=m=>`<p>预计交付 <strong>${esc(m.finish)}</strong> · ${delta(m)}</p><p>班组任务间空档 ${m.gaps} 天 · 延期 ${amount(m.delay_cost)} · 空档 ${amount(m.idle_cost)}</p>`;
  const saving=(base,next)=>{
    if(base.idle_cost==null||next.idle_cost==null)return '';
    const diff=base.idle_cost-next.idle_cost;
    if(!diff)return '';
    return '<p>相对当前计划，预计班组空档费用'+(diff>0?'减少 ':'增加 ')+amount(Math.abs(diff))+'。</p>';
  };
  const conflicts=r=>r.issues.length?`<ul>${r.issues.map(i=>`<li>${esc(i.message)} ${i.nodes.map(id=>{const n=r.nodes.find(x=>x.id===id);return n?esc(n.title)+'：'+esc(name(n.owner_id)):'';}).filter(Boolean).join('；')}</li>`).join('')}</ul>`:'<p>未发现前置日期或班组冲突。</p>';
  const table=(nodes,edit=false)=>`<div class="table-wrap schedule-table"><table><thead><tr><th>节点 / 负责人</th><th>开始</th><th>天数</th><th>班组</th><th>前置节点</th><th>保留</th></tr></thead><tbody>${nodes.map(n=>{
    const key=esc(n.id), fixed=view.locked.includes(n.id), disabled=fixed?'disabled':'';
    const cell=(kind,prop,value)=>edit?`<input type="${kind}" name="${prop}-${key}" value="${esc(value)}" ${kind==='number'?'min="1" max="365"':kind==='text'?'maxlength="60"':''} ${disabled} aria-label="${esc(n.title)} ${prop}" required>`:esc(value||'—');
    return `<tr><td><strong>${esc(n.title)}</strong><br><small>${esc(n.owner_id?name(n.owner_id):'中介协调')} · ${fixed?'已有交付记录':n.optional?'可调整节点':'必需节点'}</small></td><td>${cell('date','start',n.start)}</td><td>${cell('number','days',n.days)}</td><td>${edit?`<input name="crew-${key}" maxlength="60" value="${esc(n.crew)}" ${disabled} aria-label="${esc(n.title)} 班组">`:esc(n.crew||'未指定')}</td><td>${edit?nodes.filter(d=>d.id!==n.id&&(n.optional||!d.optional)).map(d=>`<label class="check"><input type="checkbox" name="deps-${key}" value="${esc(d.id)}" ${n.deps.includes(d.id)?'checked':''} ${disabled}>${esc(d.title)}${n.required_deps.includes(d.id)?'（必需）':''}</label>`).join(''):esc(n.deps.map(d=>nodes.find(x=>x.id===d)?.title||d).join('、')||'—')}</td><td>${edit?`<input type="checkbox" name="include-${key}" aria-label="保留 ${esc(n.title)}" ${n.included?'checked':''} ${disabled}>`:n.included?'保留':'移出'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  const proposalPanel=proposal?`<section class="card"><h2>最近一次排程提案 · ${esc(({pending:'待确认',returned:'已退回',published:'已发布',superseded:'已替换'})[proposal.status])}</h2><p>${esc(proposal.note)}</p>${metrics(proposal.result.metrics)}${table(proposal.result.nodes)}<ul>${Object.entries(proposal.approvers).map(([k,id])=>{const opinion=proposal.decisions[k];return `<li>${esc(name(id))} · ${esc(kinds[k])} · ${opinion?esc((opinion.decision==='approve'?'已确认：':'已退回：')+opinion.note):'待确认'}</li>`;}).join('')}</ul>${myRole&&!proposal.decisions[myRole]?`<form id="scheduleDecision" class="stack"><label>确认意见<textarea name="note" required maxlength="500"></textarea></label><div class="buttons"><button value="approve">确认调整</button><button value="return" class="danger">退回调整</button></div></form>`:''}${editable&&pending?`<button id="schedulePublish" ${Object.keys(proposal.decisions).length===Object.keys(proposal.approvers).length?'':'disabled'}>发布调整后的排程</button>`:''}</section>`:'';
  const timing=draft?draft.nodes.filter(n=>n.included).map(n=>{
    const old=draft.base.nodes.find(x=>x.id===n.id);
    const days=Math.round((Date.parse(n.start)-Date.parse(old.start))/86400000);
    return '<li>'+esc(n.title)+' · '+esc(old.start)+' → '+esc(n.start)+' · '+(days>0?'+':'')+days+' 天</li>';
  }).join(''):'';
  const comparison=draft?`<section class="card schedule-comparison"><h2>对比结果</h2>${editable?'<button id="scheduleSave" class="secondary">保留草稿</button>':''}<div class="grid"><div><h3>当前正式计划</h3>${metrics(draft.base_metrics)}</div><div><h3>拟调整排程</h3>${draft.issues.length?'<p class="warn">存在冲突，下列日期为草案推算。</p>':''}${metrics(draft.metrics)}</div></div>${c.kitchen_change?'':'<h3>关键工序日期</h3><ul>'+timing+'</ul>'}${conflicts(draft)}${draft.affected.length?`<p>受影响：${draft.affected.map(n=>esc(n.title)+'（'+esc(n.owner_id?name(n.owner_id):'中介协调')+'）').join('、')}</p>`:''}${draft.alternative?`<h3>候选排程</h3>${metrics(draft.alternative.metrics)}${saving(draft.base_metrics,draft.alternative.metrics)}${table(draft.alternative.nodes)}<button id="scheduleUse" class="secondary">采用候选排程</button>`:'<p>目前无法排出满足约束的候选，请调整前置条件和班组。</p>'}${editable&&(!draft.issues.length||c.kitchen_change)?`<form id="schedulePropose" class="stack"><label>调整原因<textarea name="note" required maxlength="500"></textarea></label><button>${draft.issues.length?'尝试发布 · 检查前置条件':'提交各方确认'}</button></form>`:''}</section>`:'';
  return `<div class="page-head"><h1>工期与排程</h1><p class="muted">查看节点删减或调序对交付、班组和费用的影响。</p></div>${changeToolbar()}<div class="stack">${c.kitchen_change?kitchenImpact(c,draft||proposal?.result):demoBrief(c)}<section class="card"><h2>当前正式排程 · v${view.base.number}</h2>${view.base.inferred?'<p class="notice">旧案例按任务截止日暂列为一天，尚未录入实际班组。请先核对工期输入。</p>':''}${table(view.base.nodes)}${c.kitchen_change&&!c.kitchen_change.applied?'':conflicts(view)}</section>${editable?`<section class="card"><h2>拟定调整</h2><form id="scheduleDraft" class="stack">${table(rows,true)}<div class="fields"><label>延期估算（元 / 天）<input type="number" name="delay" min="0" max="1000000" value="${draft?.fees.delay??''}"></label><label>班组空档估算（元 / 班组日）<input type="number" name="idle" min="0" max="1000000" value="${draft?.fees.idle??''}"></label></div><small>空档为同一班组在本单第一项到最后一项之间未排任务的日数。费用按输入费率估算，留空不估算。</small><div class="buttons"><button>检查并对比</button>${state.project.data.synthetic?`<button type="button" id="scheduleExample" class="secondary">${c.kitchen_change?'A · 误删图纸核验':'填入调序冲突示例'}</button>`:''}</div></form></section>`:''}${comparison}${proposalPanel}</div>`;
}
function render(){
  if(!state.user&&state.demo?.available&&!location.hash.startsWith('#join=')){
    $('#app').innerHTML='<section class="card demo-login"><h1>打开演示案例</h1><button id="retryDemo">重新连接</button></section>';
    $('#retryDemo').onclick=()=>boot();
    return;
  }
  if(!state.user){$('#app').innerHTML=authPage();bind();return;}
  let content;
  if(!state.project)content=onboarding();
  else if(state.tab==='changes')content=changesPage();
  else if(state.tab==='tasks')content=tasksPage();
  else if(state.tab==='schedule')content=schedulePage();
  else if(state.tab==='members')content=membersPage();
  else if(state.tab==='activity')content=`<div class="page-head"><h1>确认与退回记录</h1><p class="muted">原话、修订、人员确认与执行情况按时间留存。</p></div><section class="card">${eventsView(state.project.data.events)}</section>`;
  else content=overview();
  $('#app').innerHTML=shell(content);bind();
  if(state.demo?.available){
    if(!location.hash.startsWith('#join='))$('#logout').hidden=true;
    $('.sidebar-footer').insertAdjacentHTML('afterend',`<details class="demo-switch"><summary>${state.demoProfile?'切换身份':'演示身份'}</summary><div class="demo-role-grid">${demoRoleButtons()}</div></details>`);
    bindDemoRoles();
  }
}
async function enterDemo(role, initial=false){
  const result=await post('/api/demo-login',{role});
  const same=Boolean(result.demo_project_id)&&state.project?.id===result.demo_project_id;
  const tab=same?state.tab:initial?'schedule':'changes';
  const changeId=same?state.changeId:null;
  Object.assign(state,{user:result.user,csrf:result.csrf,project:null,changeId,tab,demoProfile:true,dirty:false});
  history.replaceState(null,'',location.pathname);
  const project=result.demo_project_id?await api('/api/projects/'+result.demo_project_id):await post('/api/projects/demo',{});
  state.demo.ready=true;
  await refreshProjects();
  setProject(project);
}
function bindDemoRoles(){
  document.querySelectorAll('[data-demo-role]').forEach(button=>button.onclick=async()=>{
    if(state.switching)return;
    state.switching=true;
    try{
      await busy(button,async()=>{
        await enterDemo(button.dataset.demoRole);
        if(button.dataset.createChange)$('#newChange textarea')?.focus();
      });
    }finally{state.switching=false;}
  });
}
function bindForm(selector,handler){
  const form=$(selector);if(!form)return;
  form.addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,()=>handler(new FormData(form),e));});
}
async function mutate(command,data){
  setProject(await post(`/api/projects/${state.project.id}/changes/${state.changeId}/${command}`,{...data,revision:state.project.revision}));
}
function bind(){
  document.querySelectorAll('[data-role-open]').forEach(button=>button.onclick=()=>{
    state.changeId=button.dataset.changeId;
    state.tab=button.dataset.roleOpen;
    render();
    if(button.dataset.taskFocus)document.getElementById('review-task-'+button.dataset.taskFocus)?.scrollIntoView();
  });
  bindForm('#homeIssue',async form=>{
    const id=$('#homeIssue').dataset.changeId;
    const note=String(form.get('note')).trim();
    if(!note)throw new Error('请输入现场情况。');
    const result=await post(`/api/projects/${state.project.id}/changes/${id}/comment`,{revision:state.project.revision,text:'施工问题：'+note});
    setProject(result);
    notify('施工问题已记入项目，项目经理可在首页查看。');
  });
  document.querySelectorAll('[data-schedule-change]').forEach(button=>button.onclick=()=>{
    state.changeId=button.dataset.scheduleChange;state.tab='schedule';render();
  });
  document.querySelectorAll('[data-refund-demo]').forEach(button=>button.onclick=()=>busy(button,async()=>{
    if(state.user.role!=='owner')await enterDemo('owner');
    const result=await post(`/api/projects/${state.project.id}/demo-refund`,{revision:state.project.revision});
    state.changeId=result.change_id;
    state.tab='changes';
    setProject(result.project);
    window.scrollTo(0,0);
  }));
  bindSchedule();
  bindDemoRoles();
  document.querySelectorAll('[data-review-task]').forEach(link=>link.onclick=event=>{
    event.preventDefault();
    document.getElementById('review-task-'+link.dataset.reviewTask)?.scrollIntoView({block:'start'});
  });
  if($('#accountLogin'))$('#accountLogin').onclick=()=>{state.accountLogin=true;render();};
  document.querySelectorAll('[data-auth]').forEach(button=>button.onclick=()=>{state.register=button.dataset.auth==='register';render();});
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{state.tab=button.dataset.tab;state.dirty=false;render();});
  document.querySelectorAll('form').forEach(form=>form.addEventListener('input',()=>{state.dirty=true;}));
  bindForm('#authForm',async form=>{
    const result=await post(state.register?'/api/register':'/api/login',Object.fromEntries(form));
    state.user=result.user;state.csrf=result.csrf;state.dirty=false;state.demoProfile=false;
    await refreshProjects();
    if(state.projects.length&&!location.hash.startsWith('#join='))await selectProject(state.projects[0].id);else render();
  });
  if(!state.user)return;
  $('#logout').onclick=()=>busy($('#logout'),async()=>{await post('/api/logout',{});Object.assign(state,{user:null,project:null,projects:[],csrf:'',accountLogin:false,demoProfile:false});render();});
  $('#projectSelect').onchange=e=>busy(null,()=>selectProject(e.target.value));
  $('#refresh').onclick=()=>busy($('#refresh'),async()=>{await refreshProjects();if(state.project)await selectProject(state.project.id);else render();});
  if($('#openDemo'))$('#openDemo').onclick=()=>busy($('#openDemo'),async()=>{
    const project=await post('/api/projects/demo',{});
    if(state.demoProfile)state.demo.ready=true;
    await refreshProjects();
    state.tab='schedule';
    setProject(project);
    window.scrollTo(0,0);
  });
  bindForm('#createProject',async form=>{const p=await post('/api/projects',{...Object.fromEntries(form),synthetic:form.has('synthetic')});await refreshProjects();state.tab='members';setProject(p);});
  bindForm('#joinProject',async form=>{const p=await post('/api/join',Object.fromEntries(form));history.replaceState(null,'',location.pathname);await refreshProjects();state.tab='overview';setProject(p);});
  if(!state.project)return;
  if($('#changeSelect'))$('#changeSelect').onchange=e=>{state.changeId=e.target.value;state.dirty=false;render();};
  if(state.tab==='schedule'&&$('#print'))$('#print').hidden=true;
  if($('#print'))$('#print').onclick=()=>{document.querySelector('.print-protocol')?.remove();$('.content').insertAdjacentHTML('beforeend',protocol(change()));window.print();};
  if($('#checkEvidence'))$('#checkEvidence').onclick=()=>busy($('#checkEvidence'),async()=>{await mutate('evidence-review',{});notify('资料核对已记录，请查看具体依据并人工复核。');});
  if($('#sample'))$('#sample').onclick=()=>{
    $('#newChange textarea').value=state.project.templates[$('#newChange select').value].sample;
    state.dirty=true;
  };
  bindForm('#newChange',async form=>{
    const result=await post(`/api/projects/${state.project.id}/changes`,{...Object.fromEntries(form),revision:state.project.revision});
    state.changeId=result.change_id;
    setProject(result.project);
  });
  bindForm('#disputeForm',async form=>{
    await mutate('dispute',{action:$('#disputeForm').dataset.action,note:form.get('note')});
    notify('争议记录已保存。');
  });
  bindForm('#reviseFields',async form=>{
    const fields={};
    for(const [key,value] of form){
      if(key==='reason')continue;
      fields[key]=value||null;
      if(['duration_days','parallel_days'].includes(key)&&value!=='')fields[key]=Number(value);
      if(['quoted_at','valid_until'].includes(key)&&value)fields[key]=new Date(value).toISOString();
    }
    await mutate('revise',{fields,reason:form.get('reason')});notify('新版本已保存，请完成资料上传并重新确认。');
  });
  bindForm('#assignForm',async form=>{
    const tasks=revision(change()).tasks.map(t=>({...t,title:form.get('title_'+t.id),output:form.get('output_'+t.id),owner_id:form.get('owner_'+t.id)||null,due:form.get('due_'+t.id),reviewer_ids:form.getAll('reviewer_'+t.id)}));
    const approvers=Object.fromEntries(Object.keys(kinds).map(k=>[k,form.get('approver_'+k)||null]));
    await mutate('revise',{fields:{scheme:form.get('scheme')},tasks,approvers,reason:form.get('reason')});notify('分工已保存，新版等待各方确认。');
  });
  document.querySelectorAll('[data-approve]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const data=new FormData(form);busy(e.submitter,()=>mutate('approve',{kind:form.dataset.approve,decision:e.submitter.value,note:data.get('note')}));});
  if($('#publish'))$('#publish').onclick=()=>busy($('#publish'),async()=>{await mutate('publish',{});state.tab='tasks';render();notify('正式排期与执行任务已发布。');});
  bindForm('#uploadForm',async form=>{
    const key=form.get('evidenceKey');
    if(key)form.set('reference',key+' | '+(form.get('reference')||'').trim());
    form.delete('evidenceKey');
    form.set('revision',state.project.revision);
    setProject(await api(`/api/projects/${state.project.id}/changes/${state.changeId}/files`,{method:'POST',body:form}));
    notify('资料已上传并留痕；可运行 AI 初审逐条核对。');
  });
  bindForm('#commentForm',async form=>{await mutate('comment',{text:form.get('text')});notify('协商留言已保存。');});
  document.querySelectorAll('[data-photo-task]').forEach(form=>{
    const select=form.elements.standard;
    const showCriteria=()=>{
      const rule=templateFor(change()).photo_criteria[select.value];
      form.querySelector('.photo-criteria').innerHTML=`<strong>${esc(select.value)} · 拍摄要求</strong><p>角度：${esc(rule.angle)}</p><p>内容：${esc(rule.content)}</p>`;
    };
    select.onchange=showCriteria;
    showCriteria();
    form.onsubmit=e=>{
    e.preventDefault();
    if(state.photoUploading)return;
    state.photoUploading=true;
    const button=e.submitter;
    const label=button.textContent;
    button.textContent='正在读取照片并初审…';
    busy(button,async()=>{
      const data=new FormData(form);
      data.set('revision',state.project.revision);
      const path='/api/projects/'+state.project.id+'/changes/'+state.changeId+'/tasks/'+form.dataset.photoTask+'/photos';
      setProject(await api(path,{method:'POST',body:data}));
      notify('照片与初审结果已保存。');
    }).finally(()=>{state.photoUploading=false;if(button.isConnected)button.textContent=label;});
    };
  });
  document.querySelectorAll('[data-task]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const data=new FormData(form);busy(e.submitter,()=>mutate('task',{task_id:form.dataset.task,command:e.submitter.value,note:data.get('note'),file_ids:data.getAll('file_ids')}));});
  bindForm('#acceptForm',async(form,e)=>{await mutate('accept',{decision:e.submitter.value,note:form.get('note')});});
  bindForm('#inviteForm',async form=>{
    const result=await post(`/api/projects/${state.project.id}/invitations`,{role:form.get('role'),revision:state.project.revision});
    setProject(result.project);
    const url=location.origin+'/#join='+encodeURIComponent(result.token);
    $('#inviteResult').innerHTML=`<div class="notice">${esc(roles[result.role])}邀请已生成</div><label class="copy-value">邀请链接<input readonly value="${esc(url)}"></label><label class="copy-value">邀请码<input readonly value="${esc(result.token)}"></label><small>将链接发给对应成员。同一网络内需使用对方能访问的服务器地址。</small>`;
  });
}
function bindSchedule(){
  if(state.tab!=='schedule'||!change()?.schedule_view)return;
  const c=change();
  const url='/api/projects/'+state.project.id+'/changes/'+c.id+'/schedule/';
  const write=async(command,data)=>setProject(await post(url+command,{...data,revision:state.project.revision}));
  async function preview(nodes,fees){
    const revision=state.project.revision;
    const result=await post(url+'preview',{nodes,fees,revision});
    if(change()?.id!==c.id||state.project.revision!==revision)return;
    state.scheduleDraft={changeId:c.id,revision,result};
    state.dirty=false;
    render();
    $('.schedule-comparison')?.scrollIntoView({block:'start'});
  }
  const draft=state.scheduleDraft?.changeId===c.id&&state.scheduleDraft.revision===state.project.revision?state.scheduleDraft.result:(c.schedule_draft||null);
  const proposal=c.schedule_proposals?.at(-1);
  const editor=$('#scheduleDraft');
  if(editor){
    editor.addEventListener('input',()=>editor.dataset.changed='yes');
    editor.addEventListener('change',()=>editor.dataset.changed='yes');
  }
  bindForm('#scheduleDraft',async form=>{
    const nodes=(draft?.nodes||c.schedule_view.base.nodes).map(n=>c.schedule_view.locked.includes(n.id)?n:{...n,
      start:form.get('start-'+n.id),days:Number(form.get('days-'+n.id)),crew:form.get('crew-'+n.id),
      deps:form.getAll('deps-'+n.id),included:form.has('include-'+n.id)});
    const fees=Object.fromEntries(['delay','idle'].map(k=>[k,form.get(k)===''?null:Number(form.get(k))]));
    await preview(nodes,fees);
  });
  if($('#scheduleExample'))$('#scheduleExample').onclick=()=>busy($('#scheduleExample'),async()=>{
    const nodes=c.schedule_view.base.nodes.map(n=>({...n}));
    const install=nodes.find(n=>n.id==='installation');
    if(c.schedule_view.locked.includes('installation'))throw new Error('请在铺贴任务提交前演示调序。');
    if(c.kitchen_change){
      nodes.find(n=>n.id==='preparation').included=false;
      nodes.find(n=>n.id==='materials').start=c.kitchen_change.new_arrival;
      await preview(nodes,{});
      return;
    }
    install.start=nodes.find(n=>n.id==='preparation').start;
    await preview(nodes,{delay:300,idle:450});
  });
  if($('#briefScheduleDemo'))$('#briefScheduleDemo').onclick=()=>$('#scheduleExample')?.click();
  if($('#scheduleSave'))$('#scheduleSave').onclick=()=>busy($('#scheduleSave'),()=>write('save',{nodes:draft.nodes,fees:draft.fees}));
  if($('#scheduleUse'))$('#scheduleUse').onclick=()=>busy($('#scheduleUse'),()=>preview(draft.alternative.nodes,draft.fees));
  bindForm('#schedulePropose',async form=>{
    if(state.dirty&&$('#scheduleDraft')?.dataset.changed==='yes')throw new Error('排程输入已修改，请重新检查并对比。');
    await write('propose',{nodes:draft.nodes,fees:draft.fees,note:form.get('note')});
    notify('调整方案已提交给指定确认人。');
  });
  bindForm('#scheduleDecision',async(form,e)=>write('decide',{proposal_id:proposal.id,note:form.get('note'),decision:e.submitter.value}));
  if($('#schedulePublish'))$('#schedulePublish').onclick=()=>busy($('#schedulePublish'),async()=>{
    await write('publish',{proposal_id:proposal.id});
    notify('正式排程与任务截止日已更新。');
  });
}
function showRefresh(){state.pending=true;const button=$('#refresh');if(button)button.textContent='有更新，点击刷新';}
async function boot(){
  try{state.demo=await api('/api/demo-access');}catch{}
  if(state.demo?.available&&!location.hash.startsWith('#join=')){
    try{
      await enterDemo('coordinator',true);
    }catch(error){
      state.user=null;
      render();
      notify(error.message);
    }
    return;
  }
  try{const result=await api('/api/me');state.user=result.user;state.csrf=result.csrf;state.demoProfile=result.demo_profile;await refreshProjects();if(state.projects.length&&!location.hash.startsWith('#join=')){await selectProject(state.projects[0].id);return;}}catch{}
  render();
}
setInterval(async()=>{
  if(!state.user||!state.project||state.switching||state.photoUploading||document.hidden)return;
  const userId=state.user.id, projectId=state.project.id;
  try{
    const latest=await api(`/api/projects/${projectId}`);
    if(state.switching||state.user?.id!==userId||state.project?.id!==projectId)return;
    const selected=latest.data.changes.find(c=>c.id===state.changeId);
    const reminderChanged=selected?.pending_confirmation?.overdue!==change()?.pending_confirmation?.overdue;
    if(latest.revision!==state.project.revision||reminderChanged){if(state.dirty)showRefresh();else setProject(latest);}
  }catch{}
},8000);
boot();
