'use strict';
const roles = {owner:'住户',coordinator:'中介方 / 产品总监',designer:'设计师',contractor:'施工团队'};
const statuses = {clarifying:'澄清与确认',returned:'已退回 · 等待修订',executing:'施工执行中',acceptance:'等待住户验收',closed:'已验收关闭'};
const kinds = {design:'设计确认',construction:'施工与材料条件确认',owner:'费用与交付日期确认'};
const labels = {tile_spec:'瓷砖规格',layout:'铺贴方式',start_point:'起铺点与方向',edge_detail:'过门口收边',drawing_version:'图纸版本',method:'施工方法与现场条件',supplier:'供应商名称',quote_reference:'报价单编号',quote_scope:'本次增项报价范围（数量、规格、辅材、人工）',quote_amount:'本次增项总额（元）',quoted_at:'报价时间',valid_until:'报价有效至',arrival_date:'材料承诺到场日',crew_date:'班组最早开工日',duration_days:'施工总日历天数',parallel_days:'并行方案可追回天数',parallel_scope:'可并行工作与所需条件'};
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
    if(response.status===401 && !['/api/login','/api/register'].includes(path)){state.user=null;render();}
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
function authPage(){
  const invite=new URLSearchParams(location.hash.slice(1)).get('join');
  return `<div class="auth"><section class="auth-story"><div class="brand">工序共识</div><div><h1>每一步，<br>都有共同的依据。</h1><p>把住户的装修要求，交给需要作出决定的人。确认设计、材料与工期，再一起推进施工。</p></div><div class="auth-flow"><div>住户<small>提出要求，确认交付</small></div><div>中介方 / 产品总监<small>组织协商，协调分工</small></div><div>设计师<small>完善图纸，确认做法</small></div><div>施工团队<small>核对条件，落实交付</small></div></div></section><section class="auth-main"><div class="auth-box"><h2>${state.register?'创建你的协作账号':'回到你的项目'}</h2><p class="muted">各方使用自己的账号，共享同一份项目记录。</p>${invite?'<div class="notice">你已打开项目邀请。登录后可使用邀请码加入。</div>':''}<div class="auth-tabs"><button data-auth="login" class="${state.register?'':'active'}">登录</button><button data-auth="register" class="${state.register?'active':''}">注册</button></div><form id="authForm"><label>用户名<input name="username" autocomplete="username" minlength="3" maxlength="40" required placeholder="字母、数字或邮箱"></label>${state.register?'<label>姓名<input name="name" autocomplete="name" maxlength="40" required></label><label>你的身份<select name="role">'+Object.entries(roles).map(([r,n])=>`<option value="${r}">${n}</option>`).join('')+'</select></label>':''}<label>密码<input name="password" type="password" autocomplete="${state.register?'new-password':'current-password'}" minlength="8" maxlength="128" required></label><button type="submit">${state.register?'注册并进入':'登录'}</button></form><small>当前样板支持铺砖变更的设计、施工、材料与验收协作。</small></div></section></div>`;
}
function shell(content){
  const tabs=[['overview','项目总览'],['changes','变更协商'],['tasks','执行待办'],['members','成员与邀请'],['activity','确认与退回记录']];
  return `<div class="shell"><aside class="sidebar"><div><div class="brand">工序共识</div><small>家装四方协作</small></div><nav class="nav">${tabs.map(([id,title])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}">${title}</button>`).join('')}</nav><div class="sidebar-footer"><div><strong>${esc(state.user.name)}</strong><br><small>${esc(roles[state.user.role])}</small></div><button id="logout">退出登录</button></div></aside><div class="workspace"><header class="topbar"><select id="projectSelect" aria-label="当前项目"><option value="">创建或加入项目</option>${state.projects.map(p=>`<option value="${p.id}" ${p.id===state.project?.id?'selected':''}>${esc(p.title)}</option>`).join('')}</select><div class="row"><span class="muted">${state.project?`共享版本 ${state.project.revision}`:'项目成员受邀加入'}</span><button id="refresh" class="secondary">${state.pending?'有更新，点击刷新':'刷新'}</button></div></header><main class="content">${content}</main></div></div>`;
}
function onboarding(){
  const invite=new URLSearchParams(location.hash.slice(1)).get('join')||'';
  return `<div class="page-head"><h1>把四方带进同一个项目</h1><p class="muted">中介方创建项目并发出邀请，其余成员用邀请码加入。</p></div><div class="grid">${state.user.role==='coordinator'?`<section class="card"><h2>创建装修项目</h2><form id="createProject" class="stack">${field('title','',{label:'项目名称',required:true})}${field('baseline','',{label:'原方案说明',area:true,required:true})}${field('reference','',{label:'原方案 / 图纸版本',required:true})}${field('finish_date','',{label:'原约定交付日（可留空）',type:'date'})}<label class="check"><input type="checkbox" name="synthetic">演示用合成案例</label><button>创建项目</button></form></section>`:''}<section class="card"><h2>加入已有项目</h2><form id="joinProject" class="stack">${field('token',invite,{label:'项目邀请码',required:true})}<small>请确认邀请对应的身份是${esc(roles[state.user.role])}。每个邀请码可使用一次。</small><button>加入项目</button></form></section></div>`;
}
function eventsView(events){
  return events.length?`<div class="events">${[...events].reverse().map(e=>`<div class="event"><strong>${esc(e.action)}</strong> · ${esc(e.actor_name)}<p>${esc(e.detail)}</p><small>${stamp(e.at)}</small></div>`).join('')}</div>`:'<p class="empty">还没有操作记录。</p>';
}
function overview(){
  const p=state.project, tasks=p.data.changes.flatMap(c=>c.tasks);
  const my=tasks.filter(t=>t.owner_id===state.user.id && t.status!=='approved');
  return `<div class="page-head"><div class="row between"><h1>${esc(p.title)}</h1>${p.data.synthetic?tag('演示用合成数据','warn'):tag('四方共享项目')}</div><p class="muted">先确认共同依据，再把下一步交给具体的人。</p></div><div class="stats"><div class="stat"><small>参与成员</small><strong>${p.members.length}</strong></div><div class="stat"><small>待协商变更</small><strong>${p.data.changes.filter(c=>['clarifying','returned'].includes(c.status)).length}</strong></div><div class="stat"><small>我的执行待办</small><strong>${my.length}</strong></div></div><div class="grid"><section class="card"><h2>正式施工方案</h2><dl><dt>当前版本</dt><dd>v${p.data.plan.version} · ${esc(p.data.plan.reference)}</dd><dt>方案说明</dt><dd>${esc(p.data.plan.text)}</dd><dt>交付日期</dt><dd>${esc(p.data.plan.finish_date||'待确认')}</dd></dl><details class="revision"><summary>查看原方案</summary><p>${esc(p.data.original_plan.text)}</p><small>${esc(p.data.original_plan.reference)}</small></details><div class="buttons"><button data-tab="changes">进入变更协商</button><button data-tab="members" class="secondary">邀请项目成员</button></div></section><section class="card"><h2>最近发生的事</h2>${eventsView(p.data.events.slice(-4))}</section></div>`;
}
function changeToolbar(){
  const changes=state.project.data.changes;
  return `<div class="toolbar row between"><select id="changeSelect" aria-label="选择变更">${changes.map((c,i)=>`<option value="${c.id}" ${c.id===state.changeId?'selected':''}>变更 ${i+1} · ${esc(c.source.text.slice(0,25))}</option>`).join('')}</select><button id="print" class="secondary">打印共享协议单</button></div>`;
}
function sourceForm(){
  if(state.user.role!=='owner')return '';
  return `<details class="card" ${state.project.data.changes.length?'':'open'}><summary>提出新的装修要求</summary><form id="newChange" class="stack"><label>你的原话<textarea name="text" required maxlength="2000" placeholder="例如：客厅和卧室想从分区铺砖改成全屋通铺"></textarea></label><div class="buttons"><button>提交并生成协商草案</button><button type="button" id="sample" class="secondary">填入通铺示例</button></div></form></details>`;
}
function nextSteps(c){
  if(c.status==='closed')return '<div class="notice">住户已确认验收，完整交付过程可在记录中回看。</div>';
  if(c.status==='executing')return '<div class="notice">当前版本已经确认并发布，执行人可在「执行待办」提交材料。</div>';
  if(c.status==='acceptance')return '<div class="notice">各项执行任务已确认，等待指定住户完成最终人工验收。</div>';
  if(c.status==='returned')return '<div class="notice warn">当前方案已退回。相关人员按退回意见修订，提交新版本后重新确认。</div>';
  const list=c.blockers.publish;
  return list.length?`<div class="notice warn"><strong>发布前还有 ${list.length} 项待办</strong><ul class="list">${list.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`:'<div class="notice">各方确认齐全，中介方现在可以发布执行任务。</div>';
}
function detailsForm(c){
  if(!['clarifying','returned'].includes(c.status))return '';
  const r=revision(c), role=state.user.role;
  const keys=role==='designer'?['tile_spec','layout','start_point','edge_detail','drawing_version']:
    role==='contractor'?['method','supplier','quote_reference','quote_scope','quote_amount','quoted_at','valid_until','arrival_date','crew_date','duration_days','parallel_days','parallel_scope']:[];
  if(!keys.length)return '';
  const fields=keys.map(key=>field(key,r.data[key],{area:['method','quote_scope','parallel_scope'].includes(key),wide:['method','quote_scope','parallel_scope'].includes(key),type:['quoted_at','valid_until'].includes(key)?'datetime-local':['arrival_date','crew_date'].includes(key)?'date':['quote_amount','duration_days','parallel_days'].includes(key)?'number':'text',step:key==='quote_amount'?'0.01':'1',min:0})).join('');
  return `<section class="card"><h2>${role==='designer'?'完善设计依据':'完善材料与施工条件'}</h2><p class="muted">保存后生成新版本，各方需要针对新版重新确认。缺少的信息可留空。</p><form id="reviseFields" class="fields">${fields}${field('reason','',{label:'本次修订原因',wide:true,required:true})}<div class="buttons"><button>保存修订并提交</button></div></form></section>`;
}
function assignmentForm(c){
  const r=revision(c), editable=state.user.role==='coordinator'&&['clarifying','returned'].includes(c.status);
  const rows=r.tasks.map(t=>`<tr><td>${esc(t.title)}<br><small>${esc(t.output)}</small></td><td>${esc(name(t.owner_id))}</td><td>${t.reviewer_ids.map(name).map(esc).join('、')||'待指派'}</td><td>${esc(t.due||'待确认')}</td><td>${t.depends_on.map(id=>r.tasks.find(x=>x.id===id)?.title).map(esc).join('、')||'发布后可并行'}</td></tr>`).join('');
  return `<section class="card"><h2>责任分派与前置条件</h2><p class="muted">每项行动都有执行人、确认人和交付物。</p>${editable?`<form id="assignForm"><div class="fields">${Object.entries(kinds).map(([kind,title])=>`<label>${title}${peopleSelect('approver_'+kind,r.approvers[kind],{design:'designer',construction:'contractor',owner:'owner'}[kind])}</label>`).join('')}<label>准备采用的方案<select name="scheme"><option value="sequential" ${r.data.scheme==='sequential'?'selected':''}>直接顺延</option><option value="parallel" ${r.data.scheme==='parallel'?'selected':''}>先做可并行工作</option></select></label></div>${r.tasks.map(t=>`<div class="assignment"><h3>${esc(t.title)}</h3><small>前置条件 · ${t.depends_on.map(id=>r.tasks.find(x=>x.id===id)?.title).map(esc).join('、')||'正式发布后可并行'}</small><div class="fields">${field('title_'+t.id,t.title,{label:'任务名称',required:true})}${field('output_'+t.id,t.output,{label:'交付物',required:true})}<label>执行人${peopleSelect('owner_'+t.id,t.owner_id,'contractor')}</label>${field('due_'+t.id,t.due,{label:'截止日期',type:'date'})}<div class="wide"><label>确认人（可多选）</label><div class="reviewers">${state.project.members.map(m=>`<label class="check"><input type="checkbox" name="reviewer_${t.id}" value="${m.id}" ${t.reviewer_ids.includes(m.id)?'checked':''}>${esc(m.name)}</label>`).join('')}</div></div></div></div>`).join('')}${field('reason','',{label:'分派或修订原因',required:true})}<div class="buttons"><button>保存分派与方案</button></div></form>`:`<div class="table-wrap"><table><thead><tr><th>任务与交付物</th><th>执行人</th><th>确认人</th><th>截止日</th><th>前置条件</th></tr></thead><tbody>${rows}</tbody></table></div>`}</section>`;
}
function approvalPanel(c){
  const r=revision(c);
  return `<section class="card"><h2>各方确认 · v${r.number}</h2>${Object.entries(kinds).map(([kind,title])=>{
    const approved=isApproved(c,kind),mine=r.approvers[kind]===state.user.id;
    const last=c.approvals.filter(a=>a.version===r.number&&a.kind===kind).at(-1);
    return `<div class="approval"><div class="row between"><strong>${title}</strong>${tag(approved?'已确认':last?.decision==='return'?'已退回':'待确认',approved?'':last?'red':'warn')}</div><p class="muted">${esc(name(r.approvers[kind]))}</p>${last?`<p>${esc(last.note)}</p><small>${stamp(last.at)}</small>`:''}${mine&&!approved&&c.status==='clarifying'?`<form data-approve="${kind}"><label>确认意见或退回原因<textarea name="note" required maxlength="1000"></textarea></label>${c.blockers[kind].length?`<small>${c.blockers[kind].map(esc).join('；')}</small>`:''}<div class="row"><button value="approve" ${c.blockers[kind].length?'disabled':''}>确认通过</button><button value="return" class="danger">退回修订</button></div></form>`:''}</div>`;
  }).join('')}${state.user.role==='coordinator'&&c.status==='clarifying'?`<div class="buttons"><button id="publish" ${c.blockers.publish.length?'disabled':''}>发布正式任务与排期</button></div>`:''}</section>`;
}
function planPanel(c){
  const r=revision(c),d=r.data;
  return `<section class="card"><h2>工期方案与报价</h2><div class="stack">${[['sequential','直接顺延'],['parallel','先做可并行工作']].map(([key,title])=>{const p=c.plans[key];return `<div><div class="row between"><strong>${title}</strong>${r.data.scheme===key?tag('当前选择'):''}</div><p>${p?`${p.start} 开始 → ${p.finish} 预计交付`:'待确认 · 需要到货日、班组安排及工期输入'}</p>${key==='parallel'?`<small>${esc(d.parallel_scope||'需要施工方提供可并行工作与可追回天数')}</small>`:''}</div>`;}).join('')}<small>按施工方填写的日历天数估算，计算结果随确认版本保存。</small><dl><dt>本次增项总额</dt><dd>${d.quote_amount===null?'待询价':esc(d.quote_amount)+' 元'}</dd><dt>供应商</dt><dd>${esc(d.supplier||'待确认')}</dd><dt>报价范围</dt><dd>${esc(d.quote_scope||'待确认')}</dd><dt>报价单编号</dt><dd>${esc(d.quote_reference||'待确认')}</dd><dt>有效至</dt><dd>${stamp(d.valid_until)}${d.valid_until&&new Date(d.valid_until)<new Date()?tag('已过期','red'):''}</dd></dl></div></section>`;
}
function filePanel(c){
  const role=state.user.role, cats=[];
  if(c.status==='clarifying'){
    if(role==='designer')cats.push(['drawing','设计图纸']);
    if(['coordinator','contractor'].includes(role))cats.push(['quote','供应商报价依据']);
  }
  if(c.status==='executing'&&role==='contractor')cats.push(['site','施工与验收证据']);
  const files=state.project.files.filter(f=>f.change_id===c.id);
  return `<section class="card"><h2>图纸与证据资料</h2>${files.length?files.map(f=>`<div class="file-row"><div><a href="/api/files/${f.id}">${esc(f.name)}</a><br><small>${esc(f.reference)} · 上传于 v${f.version} · ${esc(f.uploaded_by)}</small></div><small>${Math.ceil(f.size/1024)} KB</small></div>`).join(''):'<p class="muted">等待成员上传图纸、报价或现场记录。</p>'}${cats.length?`<form id="uploadForm" class="stack"><label>用途<select name="kind">${cats.map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label>${field('reference','',{label:cats[0][0]==='site'?'证据用途说明':'图纸版本 / 报价单编号（与方案字段一致）',required:true})}<label>选择文件<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx" required></label><small>单文件最多 8 MB。上传设计或报价材料前，请先完成对应字段修订。</small><button>上传并留存记录</button></form>`:''}${evidencePanel(c)}</section>`;
}
function evidencePanel(c){
  const report=c.evidence_reports?.at(-1);
  return `<div class="evidence-check"><h3>资料核对</h3><p class="muted">检查图纸、报价和交付记录是否齐备，并核对 TXT 中的文字。PDF、图片和 DOCX 请下载人工核对。</p><div class="buttons"><button id="checkEvidence" class="secondary">核对资料清单与文字</button></div>${report?`<div class="notice ${report.version!==revision(c).number?'warn':''}">${esc(report.label)}<br>核对 v${report.version} · ${stamp(report.at)}${report.version!==revision(c).number?'<br>方案已有更新，请重新核对。':''}</div><p>${report.missing.length?'待补：'+report.missing.map(esc).join('、'):'三类资料均已上传。'}</p><small>已读取文字：${report.read_files.map(esc).join('、')||'没有可读取的 TXT 文件'}</small>${report.findings.length?`<ul class="list">${report.findings.map(f=>`<li><strong>${esc(f.file)}</strong><br>「${esc(f.evidence)}」<br>${esc(f.message)}</li>`).join('')}</ul>`:'<p class="muted">本次检查未列出明确的文字冲突。</p>'}<small>资料齐备不代表施工合格，仍需各方确认和住户验收。</small>`:''}</div>`;
}
function responsibilityTable(tasks){
  return `<div class="table-wrap"><table><thead><tr><th>任务 / 交付物</th><th>执行人</th><th>确认人</th><th>截止日</th><th>前置条件</th></tr></thead><tbody>${tasks.map(t=>`<tr><td>${esc(t.title)}<br>${esc(t.output)}</td><td>${esc(name(t.owner_id))}</td><td>${t.reviewer_ids.map(name).map(esc).join('、')||'待指派'}</td><td>${esc(t.due||'待确认')}</td><td>${t.depends_on.map(id=>tasks.find(x=>x.id===id)?.title).map(esc).join('、')||'发布后可并行'}</td></tr>`).join('')}</tbody></table></div>`;
}
function protocol(c){
  const r=revision(c), p=state.project;
  return `<article class="print-protocol"><h1>工序共识 · 共享协议单</h1><p>${esc(p.title)} · 变更 ${esc(c.id)} · v${r.number} · ${esc(statuses[c.status])}</p><small>导出时间 ${stamp(new Date().toISOString())}${p.data.synthetic?' · 演示用合成案例':''}</small><h2>原始要求与共同依据</h2><p>${esc(c.source.author_name)} · ${stamp(c.source.at)}</p><p>${esc(c.source.text)}</p><p>提出时原方案：${esc((c.original_baseline||c.baseline).reference)} · ${esc((c.original_baseline||c.baseline).text)}</p><p>本版基于正式方案 v${c.baseline.version} · ${esc(c.baseline.reference)}</p><dl>${Object.entries(labels).map(([key,label])=>`<dt>${esc(label)}</dt><dd>${esc(r.data[key]??'待确认')}</dd>`).join('')}</dl><h2>工期与责任分派</h2><p>选定方案：${r.data.scheme==='parallel'?'先做可并行工作':'直接顺延'} · ${c.plans[r.data.scheme]?esc(c.plans[r.data.scheme].start)+' 至 '+esc(c.plans[r.data.scheme].finish):'日期待确认'}</p>${responsibilityTable(r.tasks)}<h2>历次确认与退回</h2>${c.approvals.map(a=>`<p>v${a.version} · ${esc(kinds[a.kind])} · ${esc(a.actor_name)} · ${a.decision==='approve'?'通过':'退回'} · ${stamp(a.at)}<br>${esc(a.note)}</p>`).join('')||'<p>尚无确认记录</p>'}<h2>已上传资料</h2>${p.files.filter(f=>f.change_id===c.id).map(f=>`<p>${esc(f.name)} · ${esc(f.reference)} · 上传于 v${f.version} · ${esc(f.uploaded_by)}</p>`).join('')||'<p>尚无资料</p>'}<h2>完整过程记录</h2>${eventsView(p.data.events.filter(e=>e.change_id===c.id))}<p>此单汇集项目内确认记录；施工结果以人工验收记录为准。</p></article>`;
}
function changesPage(){
  const c=change();
  if(!c)return `<div class="page-head"><h1>变更协商</h1><p class="muted">住户提出要求后，各方围绕同一份方案补充信息、确认分工。</p></div>${sourceForm()}${state.user.role!=='owner'?'<div class="card empty">等待住户提出要求。请先邀请四方成员加入项目。</div>':''}`;
  const r=revision(c),a=r.analysis;
  const progress=['clarifying','executing','acceptance','closed'];
  const facts=a.facts.map(f=>`<li>${esc(labels[f.field]||f.field)} · ${esc(f.value)}<br><small>原文依据「${esc(f.evidence)}」</small></li>`).join('');
  return `<div class="page-head"><h1>变更协商</h1><p class="muted">同一份依据，逐项形成共识。</p></div>${changeToolbar()}<div class="stack">${sourceForm()}<section class="card"><div class="row between"><h2>变更协议单 · v${r.number}</h2>${tag(statuses[c.status],c.status==='returned'?'red':'')}</div><p class="source">${esc(c.source.text)}</p><small>住户 ${esc(c.source.author_name)} · ${stamp(c.source.at)} · 原方案 ${esc((c.original_baseline||c.baseline).reference)}</small><div class="phase">${progress.map(key=>`<span class="${c.status===key || key==='clarifying'&&c.status==='returned'?'active':''}">${statuses[key]}</span>`).join('')}</div></section><div class="change-grid"><div class="stack"><section class="card"><h2>事实与待确认事项</h2>${tag(a.label,'neutral')}${facts?`<ul class="list">${facts}</ul>`:'<p class="muted">原话中的明确事实由各方继续核对。</p>'}<ul class="list">${a.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><details class="revision"><summary>当前设计与施工依据</summary><dl>${Object.entries(labels).map(([key,label])=>`<dt>${esc(label)}</dt><dd>${esc(r.data[key]??'待确认')}</dd>`).join('')}</dl></details></section>${detailsForm(c)}${assignmentForm(c)}<section class="card"><h2>协商与版本记录</h2><form id="commentForm" class="stack"><label>补充问题或说明<textarea name="text" required maxlength="2000"></textarea></label><button>发送到本项目</button></form>${c.versions.map(v=>`<details class="revision"><summary>v${v.number} · ${esc(v.reason)}</summary><p>${esc(v.by)} · ${stamp(v.at)}</p><p>确认人：${Object.entries(v.approvers).map(([k,id])=>esc(kinds[k])+' '+esc(name(id))).join('；')}</p>${responsibilityTable(v.tasks)}<dl>${Object.entries(labels).filter(([key])=>v.data[key]!==null).map(([key,label])=>`<dt>${esc(label)}</dt><dd>${esc(v.data[key])}</dd>`).join('')}</dl></details>`).reverse().join('')}${eventsView(state.project.data.events.filter(e=>e.change_id===c.id).slice(-12))}</section></div><div class="stack">${nextSteps(c)}${approvalPanel(c)}${planPanel(c)}${filePanel(c)}</div></div></div>`;
}
function tasksPage(){
  const c=change();
  if(!c)return '<div class="card empty">请先进入变更协商，完成方案确认。</div>';
  return `<div class="page-head"><h1>执行待办</h1><p class="muted">任务交付材料经指定人员确认后，后续工作才能继续。</p></div>${changeToolbar()}${!c.tasks.length?`<div class="card">${nextSteps(c)}</div>`:`<div class="change-grid"><div class="stack">${c.tasks.map(t=>{
    const blocked=t.depends_on.filter(id=>c.tasks.find(x=>x.id===id)?.status!=='approved');
    const mine=t.owner_id===state.user.id;
    const review=t.reviewer_ids.includes(state.user.id)&&!t.reviews.some(r=>r.by_id===state.user.id&&r.attempt===t.attempt);
    const files=state.project.files.filter(f=>f.change_id===c.id&&f.kind==='site');
    const taskStatus={ready:blocked.length?'等待前置确认':'可开始',submitted:'等待确认',returned:'退回整改',approved:'已确认完成'}[t.status];
    return `<section class="card task ${t.status}"><div class="row between"><h2>${esc(t.title)}</h2>${tag(taskStatus,t.status==='returned'?'red':'')}</div><p class="muted">执行人 ${esc(name(t.owner_id))} · 确认人 ${t.reviewer_ids.map(name).map(esc).join('、')} · 截止 ${esc(t.due)}</p><p class="details">交付物 · ${esc(t.output)}</p>${blocked.length?`<div class="notice warn">等待 ${blocked.map(id=>c.tasks.find(x=>x.id===id)?.title).map(esc).join('、')}</div>`:''}${t.submissions.map(s=>`<details class="revision"><summary>第 ${s.attempt} 次提交 · ${esc(s.by)}</summary><p>${esc(s.note)}</p><small>${stamp(s.at)}</small>${s.files.map(id=>`<p><a href="/api/files/${id}">${esc(state.project.files.find(f=>f.id===id)?.name||'查看证据')}</a></p>`).join('')}${t.reviews.filter(r=>r.attempt===s.attempt).map(r=>`<p>${esc(r.by)} · ${r.decision==='approve'?'确认通过':'退回整改'} · ${esc(r.note)}</p>`).join('')}</details>`).join('')}${mine&&!blocked.length&&['ready','returned'].includes(t.status)&&c.status==='executing'?`<form data-task="${t.id}" class="stack"><label>完成情况<textarea name="note" required></textarea></label><div><label>关联已上传的施工证据</label>${files.length?files.map(f=>`<label class="check"><input type="checkbox" name="file_ids" value="${f.id}">${esc(f.name)}</label>`).join(''):'<p class="muted">请先上传施工证据。</p>'}</div><button value="submit" ${files.length?'':'disabled'}>提交给确认人</button></form>`:''}${review&&t.status==='submitted'&&c.status==='executing'?`<form data-task="${t.id}" class="stack"><label>确认意见 / 退回原因<textarea name="note" required></textarea></label><div class="row"><button value="approve">确认本任务完成</button><button value="return" class="danger">退回整改</button></div></form>`:''}</section>`;
  }).join('')}${c.status==='acceptance'?`<section class="card"><h2>最终人工验收</h2><p>请核对交付结果与已确认方案，并记录验收结论。</p>${revision(c).approvers.owner===state.user.id?'<form id="acceptForm" class="stack"><label>验收意见<textarea name="note" required></textarea></label><div class="row"><button value="approve">验收通过并关闭</button><button value="return" class="danger">退回整改</button></div></form>':`<p class="muted">等待 ${esc(name(revision(c).approvers.owner))} 确认。</p>`}</section>`:''}${c.status==='closed'?'<div class="notice">住户已确认本次交付。</div>':''}</div><div class="stack">${filePanel(c)}<section class="card"><h2>本次执行记录</h2>${eventsView(state.project.data.events.filter(e=>e.change_id===c.id).slice(-8))}</section></div></div>`}`;
}
function membersPage(){
  return `<div class="page-head"><h1>成员与邀请</h1><p class="muted">邀请成员以各自身份加入，再把任务分派给具体的人。</p></div><div class="grid"><section class="card"><h2>项目参与方</h2>${state.project.members.map(m=>`<div class="file-row"><div><strong>${esc(m.name)}</strong><br><small>${esc(m.username)}</small></div>${tag(roles[m.role])}</div>`).join('')}</section>${state.user.role==='coordinator'?`<section class="card"><h2>邀请新成员</h2><form id="inviteForm" class="stack"><label>受邀身份<select name="role">${Object.entries(roles).map(([r,n])=>`<option value="${r}">${n}</option>`).join('')}</select></label><small>邀请三天内有效，可使用一次。</small><button>生成邀请</button></form><div id="inviteResult"></div></section>`:''}</div>`;
}
function render(){
  if(!state.user){$('#app').innerHTML=authPage();bind();return;}
  let content;
  if(!state.project)content=onboarding();
  else if(state.tab==='changes')content=changesPage();
  else if(state.tab==='tasks')content=tasksPage();
  else if(state.tab==='members')content=membersPage();
  else if(state.tab==='activity')content=`<div class="page-head"><h1>确认与退回记录</h1><p class="muted">原话、修订、人员确认与执行情况按时间留存。</p></div><section class="card">${eventsView(state.project.data.events)}</section>`;
  else content=overview();
  $('#app').innerHTML=shell(content);bind();
}
function bindForm(selector,handler){
  const form=$(selector);if(!form)return;
  form.addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,()=>handler(new FormData(form),e));});
}
async function mutate(command,data){
  setProject(await post(`/api/projects/${state.project.id}/changes/${state.changeId}/${command}`,{...data,revision:state.project.revision}));
}
function bind(){
  document.querySelectorAll('[data-auth]').forEach(button=>button.onclick=()=>{state.register=button.dataset.auth==='register';render();});
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{state.tab=button.dataset.tab;state.dirty=false;render();});
  document.querySelectorAll('form').forEach(form=>form.addEventListener('input',()=>{state.dirty=true;}));
  bindForm('#authForm',async form=>{
    const result=await post(state.register?'/api/register':'/api/login',Object.fromEntries(form));
    state.user=result.user;state.csrf=result.csrf;state.dirty=false;
    await refreshProjects();
    if(state.projects.length&&!location.hash.startsWith('#join='))await selectProject(state.projects[0].id);else render();
  });
  if(!state.user)return;
  $('#logout').onclick=()=>busy($('#logout'),async()=>{await post('/api/logout',{});state.user=null;state.project=null;state.projects=[];state.csrf='';render();});
  $('#projectSelect').onchange=e=>busy(null,()=>selectProject(e.target.value));
  $('#refresh').onclick=()=>busy($('#refresh'),async()=>{await refreshProjects();if(state.project)await selectProject(state.project.id);else render();});
  bindForm('#createProject',async form=>{const p=await post('/api/projects',{...Object.fromEntries(form),synthetic:form.has('synthetic')});await refreshProjects();state.tab='members';setProject(p);});
  bindForm('#joinProject',async form=>{const p=await post('/api/join',Object.fromEntries(form));history.replaceState(null,'',location.pathname);await refreshProjects();state.tab='overview';setProject(p);});
  if(!state.project)return;
  if($('#changeSelect'))$('#changeSelect').onchange=e=>{state.changeId=e.target.value;state.dirty=false;render();};
  if($('#print'))$('#print').onclick=()=>{document.querySelector('.print-protocol')?.remove();$('.content').insertAdjacentHTML('beforeend',protocol(change()));window.print();};
  if($('#checkEvidence'))$('#checkEvidence').onclick=()=>busy($('#checkEvidence'),async()=>{await mutate('evidence-review',{});notify('资料核对已记录，请查看具体依据并人工复核。');});
  if($('#sample'))$('#sample').onclick=()=>{$('#newChange textarea').value='客厅和卧室想从分区铺砖改成全屋通铺，请先确认铺法、材料和交付日期。';state.dirty=true;};
  bindForm('#newChange',async form=>{const result=await post(`/api/projects/${state.project.id}/changes`,{text:form.get('text'),revision:state.project.revision});state.changeId=result.change_id;setProject(result.project);});
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
  bindForm('#uploadForm',async form=>{form.set('revision',state.project.revision);setProject(await api(`/api/projects/${state.project.id}/changes/${state.changeId}/files`,{method:'POST',body:form}));notify('资料已上传。');});
  bindForm('#commentForm',async form=>{await mutate('comment',{text:form.get('text')});notify('协商留言已保存。');});
  document.querySelectorAll('[data-task]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const data=new FormData(form);busy(e.submitter,()=>mutate('task',{task_id:form.dataset.task,command:e.submitter.value,note:data.get('note'),file_ids:data.getAll('file_ids')}));});
  bindForm('#acceptForm',async(form,e)=>{await mutate('accept',{decision:e.submitter.value,note:form.get('note')});});
  bindForm('#inviteForm',async form=>{
    const result=await post(`/api/projects/${state.project.id}/invitations`,{role:form.get('role'),revision:state.project.revision});
    setProject(result.project);
    const url=location.origin+'/#join='+encodeURIComponent(result.token);
    $('#inviteResult').innerHTML=`<div class="notice">${esc(roles[result.role])}邀请已生成</div><label class="copy-value">邀请链接<input readonly value="${esc(url)}"></label><label class="copy-value">邀请码<input readonly value="${esc(result.token)}"></label><small>将链接发给对应成员。同一网络内需使用对方能访问的服务器地址。</small>`;
  });
}
function showRefresh(){state.pending=true;const button=$('#refresh');if(button)button.textContent='有更新，点击刷新';}
async function boot(){
  try{const result=await api('/api/me');state.user=result.user;state.csrf=result.csrf;await refreshProjects();if(state.projects.length&&!location.hash.startsWith('#join=')){await selectProject(state.projects[0].id);return;}}catch{}
  render();
}
setInterval(async()=>{
  if(!state.user||!state.project||document.hidden)return;
  try{
    const latest=await api(`/api/projects/${state.project.id}`);
    if(latest.revision!==state.project.revision){if(state.dirty)showRefresh();else setProject(latest);}
  }catch{}
},8000);
boot();
