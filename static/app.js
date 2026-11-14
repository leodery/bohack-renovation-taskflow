const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={user:null,csrf:'',projects:[],project:null,projectsLoading:false,changeId:null,tab:'overview',demo:null,demoProfile:false,roadshow:false,dirty:false,scheduleDraft:null,noteAnalysis:null,switching:false,photoUploading:false};
const roles={owner:'住户',coordinator:'中介方',designer:'设计师',contractor:'施工团队',mediator:'外部复核人'};
const kinds={owner:'住户',design:'设计',construction:'施工'};
const photoStatuses={pass:'通过',uncertain:'待确认',fail:'不通过'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tag=(s,cls='')=>`<span class="tag ${cls}">${esc(s)}</span>`;
const stamp=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'—';
const name=id=>state.project?.members.find(m=>m.id===id)?.name||id;
const isPhoto=n=>/\.(jpe?g|png)$/i.test(n);
async function api(path,options={}){
  const response=await fetch(path,{headers:{'X-CSRF-Token':state.csrf,...(options.headers||{})},...options});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'请求失败，请稍后重试。');
  return data;
}
function post(path,body){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
function notify(message){
  const toast=$('#toast');toast.textContent=message;toast.hidden=false;
  clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.hidden=true,3600);
}
async function busy(button,work){
  const original=button?.textContent;
  if(button){button.disabled=true;if(original)button.textContent='处理中…';}
  try{return await work();}finally{if(button){button.disabled=false;if(original)button.textContent=original;}}
}
function setProject(project){
  state.project=project;state.projectsLoading=false;
  if(!state.changeId||!project.data.changes.some(c=>c.id===state.changeId))state.changeId=project.data.changes.at(-1)?.id||null;
  render();
}
function change(){return state.project.data.changes.find(c=>c.id===state.changeId)||null;}
function revision(c){return c.revisions.at(-1);}
function templateFor(c){return state.project.templates[c.template_id];}
const demoRoles=[
  ['coordinator','创建案例和协调分工','查看排程、组织确认与发布'],
  ['owner','查看方案与验收','阅读变更、确认费用与验收'],
  ['designer','确认图纸和设计','核对图纸、给出设计意见'],
  ['contractor','执行任务和上传留痕','提交任务、上传现场照片'],
];
const demoRoleButtons=()=>demoRoles.map(([id,title,desc])=>`<button data-demo-role="${id}" class="secondary"><strong>${roles[id]}（演示）</strong><small>${title} · ${desc}</small></button>`).join('');
const demoHeroTiles=()=>demoRoles.map(([id,title,desc])=>`<button data-demo-role="${id}"><strong>${roles[id]}（演示）</strong><small>${title} · ${desc}</small></button>`).join('');
function authPage(){
  if(state.demo?.available&&!location.hash.startsWith('#join='))return `<div class="hero-stage"><div class="hero-materials"><i></i><i></i><i></i><i></i></div><div class="hero-pill"><span class="brand">工序共识</span><span class="hero-meta">四方家装协作 · 演示案例</span></div><div class="hero-card"><p class="hero-eyebrow">(01) 共同的依据 · 同一套工序与留痕</p><h1>让每一次变更，都有<em>共同的依据</em></h1><p class="lead">住户、中介、设计、施工在同一份方案与排程上协作。选择一个身份进入演示案例，体验从提出需求到验收留痕的完整流程。</p><div class="hero-tiles">${demoHeroTiles()}</div><div class="hero-foot"><button id="accountLogin" class="secondary">使用账号登录</button><span class="hero-note">演示数据为合成案例，不会改动真实项目。</span></div></div></div>`;
  const register=state.register;const hash=location.hash.startsWith('#join=')?`<input type="hidden" name="token" value="${esc(decodeURIComponent(location.hash.slice(6)))}">`:'';
  return `<div class="auth"><section class="auth-story"><span class="brand">工序共识</span><h1>把口头约定，变成可核对的<em>共同的依据</em></h1><p>原方案、变更、报价、排程与现场照片在同一项目中按版本留存，各方确认后再进入下一步。</p><div class="auth-flow"><div><strong>同一套方案</strong><small>版本与修订留痕</small></div><div><strong>同一份排程</strong><small>节点、班组与冲突检查</small></div><div><strong>同一组留痕</strong><small>照片初审与验收记录</small></div></div></section><section class="auth-main"><div class="auth-box"><div class="auth-tabs"><button data-auth="login" class="${register?'':'active'}">登录</button><button data-auth="register" class="${register?'active':''}">注册</button></div><form id="authForm" class="stack">${hash}<label>用户名<input name="username" required autocomplete="username"></label><label>姓名<input name="name" required autocomplete="name"></label><label>密码<input name="password" type="password" minlength="8" required autocomplete="${register?'new-password':'current-password'}"></label><button>${register?'创建账号':'登录'}</button></form></div></section></div>`;
}
function shell(content){
  const tabs=state.project.data.synthetic||state.user.role==='mediator'?[
    ['overview','项目总览'],['changes','变更协商'],['tasks','施工与照片'],['schedule','工期与排程'],['members','成员与邀请'],['activity','确认记录'],
  ]:[['overview','项目总览'],['changes','变更协商'],['tasks','施工与照片'],['schedule','工期与排程'],['members','成员与邀请'],['activity','确认记录']];
  return `<div class="shell"><aside class="sidebar"><span class="brand">工序共识</span><small>${esc(state.project.title)}</small><nav class="nav">${tabs.map(([id,label])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}">${label}</button>`).join('')}</nav><div class="sidebar-footer"><small>${esc(state.user.name)} · ${roles[state.user.role]}</small><button id="logout">退出</button></div></aside><main class="workspace"><div class="topbar"><select id="projectSelect">${state.projects.map(p=>`<option value="${esc(p.id)}" ${p.id===state.project.id?'selected':''}>${esc(p.title)}</option>`).join('')}</select><button id="refresh" class="secondary">刷新</button></div><div class="content">${content}</div></main></div>`;
}
function onboarding(){
  if(state.user.role!=='coordinator')return `<div class="card empty"><h2>等待项目邀请</h2><p>请联系中介方创建项目并邀请你加入。</p></div>`;
  return `<div class="page-head"><h1>创建项目</h1><p class="muted">先记录原装修约定，再邀请各参与方加入。</p></div><div class="grid"><section class="card"><form id="createProject" class="stack"><label>项目名称<input name="title" required maxlength="100"></label><label>原方案说明<textarea name="baseline" required></textarea></label><label>原图纸或方案版本<input name="reference" required maxlength="100"></label><label>原交付日期<input name="finish_date" type="date"></label><label class="check"><input type="checkbox" name="synthetic">合成练习项目</label><button>创建项目</button></form></section><section class="card"><h2>接下来</h2><p>项目创建后，你可以在「成员与邀请」中生成邀请链接，分发给设计、施工和住户。</p></section></div>`;
}
function overview(){
  const p=state.project;const changes=p.data.changes;
  const counts={total:changes.length,active:changes.filter(c=>!['closed','rejected'].includes(c.status)).length,closed:changes.filter(c=>c.status==='closed').length};
  const mine=changes.filter(c=>revision(c).approvers&&Object.values(revision(c).approvers).includes(state.user.id));
  return `<div class="page-head"><h1>项目总览</h1><p class="muted">${esc(p.title)} · 所有变更与确认状态集中在此。</p></div><div class="stats"><div class="stat"><strong>${counts.total}</strong><small>变更总数</small></div><div class="stat"><strong>${counts.active}</strong><small>进行中</small></div><div class="stat"><strong>${counts.closed}</strong><small>已验收关闭</small></div></div><div class="grid"><section class="card"><h2>与我相关的变更</h2>${mine.length?mine.map(c=>{const r=revision(c);return `<div class="file-row"><div><strong>${esc(c.source.text)}</strong><br><small>${esc(r.data.title||c.template_id)} · ${tag(c.status)}</small></div><a data-role-open="changes" data-change-id="${esc(c.id)}">查看</a></div>`;}).join(''):'<p class="muted">当前没有需要你确认的变更。</p>'}</section><section class="card"><h2>项目参与方</h2>${p.members.map(m=>`<div class="file-row"><div><strong>${esc(m.name)}</strong><br><small>${esc(m.username)}</small></div>${tag(roles[m.role])}</div>`).join('')}</section></div>`;
}
function nextSteps(c){
  const blockers=c.blockers;const steps=[];
  for(const [kind,label] of Object.entries(kinds)){
    const b=blockers[kind];if(b.length)steps.push(`<li><strong>${label}侧待补 · ${esc(b[0].label)}</strong><small>${esc(b[0].detail)}</small></li>`);
  }
  return `<h2>下一步</h2>${steps.length?`<ul class="list">${steps.join('')}</ul>`:'<p>当前条件已满足，可继续推进或发布。</p>'}`;
}
function changeToolbar(){return `<div class="toolbar row"><select id="changeSelect">${state.project.data.changes.map(c=>`<option value="${esc(c.id)}" ${c.id===change().id?'selected':''}>${esc(c.source.text.slice(0,28))} · ${esc(c.status)}</option>`).join('')}</select></div>`;}
function roleHome(c){
  const r=revision(c);const myKind=Object.entries(kinds).find(([,])=>false);
  const approverKind=Object.entries(r.approvers).find(([,id])=>id===state.user.id)?.[0];
  if(!approverKind)return '';
  const b=c.blockers[approverKind];
  return `<section class="card ${approverKind}-home"><h2>${roles[state.user.role]}待办</h2>${b.length?b.map(x=>`<p><strong>${esc(x.label)}</strong><br><small>${esc(x.detail)}</small></p>`).join(''):`<p>本方材料已齐备，等待其他方或进入下一步。</p>`}<div class="buttons"><button data-role-open="changes" data-change-id="${esc(c.id)}">进入变更单</button></div></section>`;
}
function changesPage(){
  const c=change();
  if(!c)return '<div class="card empty">还没有变更记录。住户提出需求后会显示在这里。</div>';
  const r=revision(c);const phaseMap=['requested','clarifying','reviewing','executing','acceptance','closed'];const current=phaseMap.indexOf(c.status);
  const phaseLabels=['提出需求','澄清资料','各方审核','执行交付','验收','关闭'];
  return `<div class="page-head"><h1>变更协商</h1><p class="muted">原话、方案、报价与确认按版本留存。</p></div>${changeToolbar()}<div class="stack"><section class="card"><h2>${esc(r.data.title||'变更单')}</h2><p class="source">${esc(c.source.text)}<br><small>${esc(c.source.by)} · ${stamp(c.source.at)}</small></p><div class="phase">${phaseLabels.map((l,i)=>`<span class="${i===current?'active':''}">${l}</span>`).join('')}</div></section>${roleHome(c)}<div class="change-grid"><div class="stack">${c.collaboration?collaborationBlock(c):classicBlock(c)}<section class="card"><h2>修订版本</h2>${c.revisions.map((v,i)=>`<div class="revision"><div class="row between"><strong>v${v.number} · ${esc(v.data.title||c.template_id)}</strong>${tag(v.by)}</div><dl>${Object.entries(v.data).filter(([k])=>!['tasks','approvers','quote'].includes(k)).slice(0,6).map(([k,val])=>`<dt>${esc(k)}</dt><dd>${esc(typeof val==='object'?JSON.stringify(val):val)}</dd>`).join('')}</dl></div>`).join('')}</section></div><div class="stack">${filePanel(c)}<section class="card"><h2>确认与留言</h2>${eventsView(state.project.data.events.filter(e=>e.change_id===c.id).slice(-10))}</section></div></div></div>`;
}
function collaborationBlock(c){
  const col=c.collaboration;const r=revision(c);
  return `<section class="card"><h2>快速协商</h2><p class="muted">${esc(col.proposal)}</p>${col.status==='review'?`<form id="simpleDecision" class="stack" data-approve="collaboration"><input type="hidden" name="version" value="${col.version}"><label>确认意见<textarea name="note" required></textarea></label><div class="row"><button value="approve">确认可行</button><button value="return" class="danger">需要补充</button></div></form>`:tag('状态 '+col.status)}<form id="commentForm" class="stack"><label>协商留言<textarea name="text" required></textarea></label><button>留</button></form><form id="simplePhoto" class="stack"><label>现场说明<input name="reference" required></label><label>现场照片<input name="file" type="file" accept="image/*" capture="environment"></label><button>上传照片</button></form></section>`;
}
function classicBlock(c){
  const r=revision(c);
  return `<section class="card"><h2>方案与分工</h2><div class="stack"><form id="reviseFields" class="stack"><h3>关键信息</h3><div class="fields">${['title','drawing_version','quote_reference'].map(k=>`<label>${k}<input name="${k}" value="${esc(r.data[k]||'')}"></label>`).join('')}</div><label>原因 / 说明<textarea name="reason">${esc(r.data.reason||'')}</textarea></label><div class="buttons"><button>保存修订</button></div></form><form id="assignForm" class="stack"><h3>任务与确认人</h3>${r.tasks.map(t=>`<div class="assignment"><div class="row between"><strong>${esc(t.title)}</strong><small>${esc(t.output)}</small></div><div class="fields"><label>执行人<select name="owner_${t.id}">${state.project.members.map(m=>`<option value="${m.id}" ${m.id===t.owner_id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>截止<input name="due_${t.id}" type="date" value="${esc(t.due)}"></label></div><label>确认人${t.reviewer_ids.map(rid=>`<label class="check"><input type="checkbox" name="reviewer_${t.id}" value="${rid}" ${t.reviewer_ids.includes(rid)?'checked':''}>${esc(name(rid))}</label>`).join('')}</label></div>`).join('')}<h3>各方确认</h3><div class="fields">${Object.entries(kinds).map(([k,label])=>`<label>${label}确认人<select name="approver_${k}"><option value="">未指定</option>${state.project.members.map(m=>`<option value="${m.id}" ${m.id===r.approvers[k]?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>`).join('')}</div><label>方案说明<textarea name="reason">${esc(r.data.scheme||'')}</textarea></label><div class="buttons"><button>保存分工</button></div></form>${c.status==='clarifying'?`<form id="uploadForm" class="stack"><h3>上传审批资料</h3><label>文件用途<select name="evidenceKey">${templateFor(c).evidence.map(e=>`<option value="${e.key}">${e.label}</option>`).join('')}</select></label><label>版本说明<input name="reference" required></label><label>选择文件<input name="file" type="file" required></label><button>上传</button></form>`:''}${c.status==='reviewing'?`<form data-approve="classic" class="stack"><label>确认意见<textarea name="note" required></textarea></label><div class="row"><button value="approve">确认通过</button><button value="return" class="danger">退回</button></div></form>`:''}${c.status==='executing'&&r.approvers.owner===state.user.id?'':''}${c.status==='acceptance'?'':''}${c.status==='clarifying'?`<button id="checkEvidence">运行资料核对</button>`:''}${c.status==='reviewing'&&state.user.role==='coordinator'?'<button id="publish">发布</button>':''}</div></section>`;
}
function filePanel(c){
  const files=state.project.files.filter(f=>f.change_id===c.id);
  return `<section class="card"><h2>资料与留痕</h2>${files.length?files.map(f=>`<div class="file-row"><div>${isPhoto(f.name)?`<img class="thumb" src="/api/files/${f.id}/preview" alt="">`:''}<strong>${esc(f.name)}</strong><br><small>${esc(f.reference)} · ${esc(f.uploaded_by)}</small></div><a href="/api/files/${f.id}" target="_blank" rel="noopener">下载</a></div>`).join(''):'<p class="muted">暂无资料。</p>'}</section>`;
}
function eventsView(events){
  if(!events.length)return '<p class="muted">暂无记录。</p>';
  return `<div class="events">${events.map(e=>`<div class="event"><strong>${esc(e.action)}</strong><p>${esc(e.detail)}</p><small>${esc(e.by)} · ${stamp(e.at)}</small></div>`).join('')}</div>`;
}
function collaborationPage(){
  const cases=state.project.data.changes.filter(c=>c.collaboration);
  const c=cases.find(x=>x.id===state.changeId)||cases.at(-1);
  if(c)state.changeId=c.id;
  if(!c)return onboarding();
  const col=c.collaboration;const r=revision(c);
  return `<div class="page-head"><h1>协作工作台</h1><p class="muted">在同一变更单上快速确认、留言与上传照片。</p></div><div class="stack">${roleHome(c)}<section class="card"><div class="row between"><h2>${esc(col.proposal)}</h2>${tag(col.status)}</div><div class="phase"><span class="active">${esc(col.status)}</span></div></section><div class="change-grid"><div class="stack"><form id="simpleDecision" class="stack" data-approve="collaboration"><input type="hidden" name="version" value="${col.version}"><label>确认意见<textarea name="note" required></textarea></label><div class="row"><button value="approve">确认可行</button><button value="return" class="danger">需要补充</button></div></form><form id="commentForm" class="stack"><label>协商留言<textarea name="text" required></textarea></label><button>留</button></form></div><div class="stack"><form id="simplePhoto" class="stack"><label>现场说明<input name="reference" required></label><label>现场照片<input name="file" type="file" accept="image/*" capture="environment"></label><button>上传照片</button></form>${filePanel(c)}</div></div></div>`;
}
function photoReviewQueue(c){
  const tasks=c.tasks;const files=state.project.files;
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
  return `<div class="page-head"><h1>施工与照片</h1><p class="muted">任务交付材料经指定人员确认后，后续工作才能继续。</p></div>${changeToolbar()}${photoReviewQueue(c)}${!c.tasks.length?`<div class="card">${nextSteps(c)}</div>`:`<div class="change-grid"><div class="stack">${c.tasks.map(t=>{
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
  return `<section class="card"><h2>厨房墙砖变更 · 影响对比</h2><p>${esc(k.request)} 新砖调整至 ${esc(k.new_arrival)} 到货。</p><h3>关键工序 · 原开始日与拟议开始日</h3><ul>${timing}</ul><h3>费用与核实人</h3><p>同范围材料报价 ${k.old_quote} → ${k.new_quote} 元，差额 <strong>+${k.new_quote-k.old_quote} 元</strong>。${quote?`<a href="/api/files/${quote.id}">报价 ${esc(k.quote_reference)}</a>`:''}</p><p>瓦工待工费 <strong>待核实</strong> · ${esc(name(k.cost_owner))}</p><p>建议：${esc(k.advice)} 原文依据「${esc(k.evidence)}」。</p><h3>${k.applied?'确认结果':'确认分工'}</h3><p>${k.applied?'设计、施工和住户已确认，项目经理已发布新版排程。':`设计师 ${esc(name(k.drawing_owner))} 核对新版图纸，施工方核对到货和人员档期，住户核对费用。`}</p></section>`;
}
function noteAnalysis(c, initial){
  const previous=state.noteAnalysis?.changeId===c.id?state.noteAnalysis:null;
  const result=previous?.result;
  const items=(rows)=>`<ul class="list">${rows.map(item=>`<li><strong>${esc(item.finding)}</strong><p>可能影响：${esc(item.impact)}</p><p>处理建议：${esc(item.action)}</p><small>原文依据：${item.evidence.map(e=>'「'+esc(e)+'」').join(' ')}</small></li>`).join('')}</ul>`;
  return `<section class="notice"><form id="roadshowNote" class="stack" data-change-id="${esc(c.id)}"><label>待分析的变更说明或施工备注<textarea name="text" required maxlength="500">${esc(previous?.text||initial.slice(0,500))}</textarea></label><button>提取影响和建议</button></form>
  ${result?`<div class="note-result" aria-live="polite"><strong>${result.mode==='model'?'AI 辅助分析':result.mode==='fallback'?'模型未提供可用结果 · 规则检查':'规则检查'}</strong>${result.items.length?items(result.items):'<p>这段文字没有明确的可核对事项。补上材料日期、班组安排或要改动的工序后可再分析。</p>'}${result.checks?.length?`<div><strong>规则复核</strong>${items(result.checks)}</div>`:''}</div>`:''}</section>`;
}
function demoGuide(c,draft,proposal){
  if(!c.kitchen_change||!state.demoProfile)return '';
  const manager=state.user.role==='coordinator';
  const pending=proposal?.status==='pending';
  const entries=pending?Object.entries(proposal.approvers):[];
  const waiting=entries.filter(([k])=>proposal.decisions[k]?.decision!=='approve');
  const mine=waiting.some(([,id])=>id===state.user.id);
  const roadshow=new URLSearchParams(location.search).get('show')==='1'||state.roadshow;
  let title='检查到货变化的影响',copy='核对新砖到货日期是否影响铺贴、班组安排和费用。',action='检查变更影响',key='check';
  if(c.kitchen_change.applied){title='新版排程已生效';copy='三方确认已留档。施工人员可以查看新版任务，按前置工序逐项执行。';action='切到施工方上传照片';key='tasks';}
  else if(pending){
    title='相关人员确认后发布';
    copy=waiting.length?'还在等 '+waiting.map(([,id])=>name(id)).join('、')+' 确认。':'三方已确认，可以发布新版排程。';
    action=mine?'确认本版方案':waiting.length?'切换到下一位确认人':manager?'发布新版排程':'切回项目经理发布';
    key=mine?'confirm':waiting.length?'switch':manager?'publish':'manager';
  }else if(draft?.issues.length){
    const missingDrawing=draft.nodes.some(n=>n.id==='preparation'&&!n.included);
    title=missingDrawing?'厨房铺砖缺少新版图纸核验':'当前排程需要调整';
    copy=missingDrawing?`核验负责人：${name(c.kitchen_change.drawing_owner)}。恢复核验后，再按新砖到货日安排铺砖。`:'新砖到货时间与原排程有冲突。按新到货日重新核对铺贴时间和班组安排。';
    action=missingDrawing?'恢复核验并查看新排程':'查看可行排程';key='repair';
  }else if(draft){
    title='新排程可以提交确认';
    const old=draft.base.nodes.find(n=>n.id==='installation'),next=draft.nodes.find(n=>n.id==='installation');
    copy='厨房铺砖 '+old.start+' → '+next.start+'。材料报价增加 '+(c.kitchen_change.new_quote-c.kitchen_change.old_quote)+' 元，瓦工待工费待核实。';
    action='提交给三方确认';key='submit';
  }
  if(!manager&&!pending&&!c.kitchen_change.applied){action='切回项目经理';key='manager';}
  const simulate=manager&&!pending&&!c.kitchen_change.applied;
  const rehearse=pending&&manager&&waiting.some(([kind])=>kind!=='owner');
  const tools=roadshow&&(simulate||rehearse)?`<details class="revision roadshow-tools"><summary>路演演示工具</summary>${simulate?'<p>模拟只修改演示草稿。</p><button type="button" class="secondary" id="simulateMissingDrawing">模拟缺少图纸核验</button>':'<button type="button" class="secondary" id="rehearseApprovals">准备前两方演示确认</button>'}</details>`:'';
  const note=!c.kitchen_change.applied?`<details class="revision" ${state.noteAnalysis?.changeId===c.id?'open':''}><summary>分析施工备注</summary>${noteAnalysis(c,'砖周五才到，瓦工只约了周四。')}</details>`:'';
  return `<section class="card demo-guide"><h2>${title}</h2><p>${esc(copy)}</p><div class="buttons"><button id="guideAction" data-guide="${key}">${action}</button><button type="button" class="secondary" data-refund-demo>查看返费结果示例</button></div>${note}${tools}</section>`;
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
  const full=`<div class="page-head"><h1>工期与排程</h1><p class="muted">查看节点删减或调序对交付、班组和费用的影响。</p></div>${changeToolbar()}<div class="stack">${c.kitchen_change?kitchenImpact(c,draft||proposal?.result):demoBrief(c)}<section class="card"><h2>当前正式排程 · v${view.base.number}</h2>${view.base.inferred?'<p class="notice">旧案例按任务截止日暂列为一天，尚未录入实际班组。请先核对工期输入。</p>':''}${table(view.base.nodes)}${c.kitchen_change&&!c.kitchen_change.applied?'':conflicts(view)}</section>${editable?`<section class="card"><h2>拟定调整</h2><form id="scheduleDraft" class="stack">${table(rows,true)}<div class="fields"><label>延期估算（元 / 天）<input type="number" name="delay" min="0" max="1000000" value="${draft?.fees.delay??''}"></label><label>班组空档估算（元 / 班组日）<input type="number" name="idle" min="0" max="1000000" value="${draft?.fees.idle??''}"></label></div><small>空档为同一班组在本单第一项到最后一项之间未排任务的日数。费用按输入费率估算，留空不估算。</small><div class="buttons"><button>检查并对比</button>${state.project.data.synthetic&&!c.kitchen_change?'<button type="button" id="scheduleExample" class="secondary">填入调序冲突示例</button>':''}</div></form></section>`:''}${comparison}${proposalPanel}</div>`;
  const guide=demoGuide(c,draft,proposal);
  return guide?`<div class="page-head"><h1>厨房墙砖变更</h1><p class="muted">业主提出更换厨房墙砖，新砖比原计划晚到两天。</p></div>${guide}<details class="revision guide-details" ${draft?.issues.length?'open':''}><summary>查看排程、报价和确认记录</summary>${full}</details>`:full;

}
function render(){
  if(!state.user&&state.demo?.available&&!location.hash.startsWith('#join=')){
    $('#app').innerHTML=authPage();
    bind();
    return;
  }
  if(!state.user){$('#app').innerHTML=authPage();bind();return;}
  let content;
  if(state.project&&!state.roadshow&&state.user.role!=='mediator'){
    const cases=state.project.data.changes.filter(c=>c.collaboration);
    if(!cases.some(c=>c.id===state.changeId))state.changeId=cases.at(-1)?.id??null;
    content=collaborationPage();
  }else if(!state.project)content=onboarding();
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
  state.roadshow=state.roadshow||new URLSearchParams(location.search).get('show')==='1';
  const result=await post('/api/demo-login',{role});
  const same=Boolean(result.demo_project_id)&&state.project?.id===result.demo_project_id;
  const tab=same?state.tab:initial?'schedule':'changes';
  const changeId=same?state.changeId:null;
  Object.assign(state,{user:result.user,csrf:result.csrf,project:null,changeId,tab,demoProfile:true,dirty:false});
  history.replaceState(null,'',location.pathname+(state.roadshow?'?show=1':''));
  const project=result.demo_project_id?await api('/api/projects/'+result.demo_project_id):await post('/api/projects/demo',{});
  state.demo.ready=true;
  if(initial)state.changeId=project.data.changes.find(c=>c.kitchen_change)?.id||state.changeId;
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
async function openTaskPhoto(){
  const id=change()?.id;
  if(!id)return;
  if(state.user.role!=='contractor'&&state.demoProfile&&state.demo?.ready)await enterDemo('contractor');
  state.changeId=id;
  state.tab='tasks';
  render();
  const form=$('[data-photo-task]');
  if(form){
    form.scrollIntoView({block:'center'});
    form.querySelector('[name=file]').focus({preventScroll:true});
  }else{
    const c=change();
    const own=c.tasks.filter(t=>t.owner_id===state.user.id);
    if(c.schedule_task_locks?.length)notify('请先在「工期与排程」完成变更确认并发布。');
    else if(own.some(t=>t.status==='submitted'))notify('该任务已提交，确认人退回后可以补传照片。');
    else notify('当前没有可上传的任务。请查看责任人和前置条件。');
    window.scrollTo(0,0);
  }
}
function bindExamples(){
  if(!state.project?.data.synthetic)return;
  const c=change();
  const material=c?.collaboration?.trigger==='materials';
  const role=state.user.role;
  const examples={
    commentForm:material?'建议先核对替代砖的样品、报价和到货日，再决定是否换砖。':'请确认浅色墙砖的样品、报价和到货日，客厅按原方案施工。',
    homeIssue:'原定墙砖未按期到货，请协调新的到货时间和瓦工档期。',
    acceptForm:'已查看现场照片，厨房墙砖颜色和收边符合确认方案。',
    disputeForm:'替代材料的报价和到货日期尚未明确，请补充依据。',
    schedulePropose:'根据新砖到货时间调整瓦工档期，保留图纸核验。',
    roadshowNote:'砖周五才到，瓦工只约了周四。待工费还没报价。',
  };
  const approval=role==='owner'?'我同意本版调整，请按确认后的方案施工。':
    role==='designer'?'设计上可行。已核对墙砖调整范围，客厅保留原设计。':
    '施工上可行。开工前会按确认方案核对墙砖规格、到货和班组档期。';
  for(const input of document.querySelectorAll('form textarea, #simplePhoto [name=reference]')){
    const form=input.form;
    if(form.id==='newChange')continue;
    let samples=[[examples[form.id]||input.placeholder.replace(/^例如[：:]\s*/,'')||'按当前版本核对，具体调整以各方确认的记录为准。','填入示例']];
    if(form.id==='simpleDecision'||form.matches('[data-approve]')){
      samples=[];
      if(form.querySelector('[value=approve]'))samples.push([approval,'填入确认示例']);
      if(form.querySelector('[value=return]'))samples.push(['请先补充墙砖的样品、差价和到货日期，核对后再确认。','填入退回示例']);
      if(form.querySelector('[value=revise]'))samples.push([
        material?'厨房改用同规格米白墙砖，客厅照旧；到货日及差价以新报价为准。':'仅调整厨房墙砖颜色，客厅照旧；开工前核对样品和到货日期。',
        '填入修订示例']);
    }else if(form.id==='simplePhoto'){
      samples=[['厨房墙砖到货，拍摄包装标签与规格。','填入示例']];
    }else if(form.matches('[data-task]')){
      samples=[['已核对本工序要求，现场情况见上传照片。','填入示例']];
    }else if(form.matches('[data-site-issue]')){
      samples=[['已联系供应商确认新到货时间，并通知施工班组调整档期。','填入示例']];
    }
    const controls=document.createElement('div');
    controls.className='buttons';
    for(const [text,label] of samples){
      const button=document.createElement('button');
      button.type='button';
      button.className='secondary';
      button.dataset.fillExample='';
      button.dataset.text=text;
      button.textContent=label;
      controls.append(button);
    }
    (input.closest('label')||input).after(controls);
    controls.querySelectorAll('button').forEach(button=>button.onclick=()=>fillExample(input,button.dataset.text));
  }
  const intake=$('#newChange [data-fill-example]');
  if(intake)intake.onclick=()=>fillExample($('#newChange textarea'),intake.dataset.text);
}
function fillExample(input,text){
  input.value=text;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.focus();
  input.setSelectionRange(input.value.length,input.value.length);
}
function bind(){
  bindExamples();
  document.querySelectorAll('[data-translate]').forEach(button=>button.onclick=()=>busy(button,async()=>{
    const output=button.parentElement.querySelector('[data-translation-result]');
    output.hidden=false;
    output.textContent='正在转述…';
    try{
      const result=await post(`/api/projects/${state.project.id}/changes/${change().id}/translate`,
        {event_id:button.dataset.translate||null});
      output.textContent=result.status==='ok'?'AI 转述（请对照原文）：'+result.translation:
        result.status==='unconfigured'?'模型尚未配置，可直接查看上方原文。':'模型暂时无法转述，可以重试或查看上方原文。';
    }catch(error){
      output.textContent=error.message;
    }
  }));
  document.querySelectorAll('[data-open-photo]').forEach(button=>button.onclick=()=>busy(button,openTaskPhoto));
  document.querySelectorAll('[data-role-open]').forEach(button=>button.onclick=()=>{
    state.changeId=button.dataset.changeId;
    state.tab=button.dataset.roleOpen;
    render();
    if(button.dataset.taskFocus)document.getElementById('review-task-'+button.dataset.taskFocus)?.scrollIntoView();
  });
  async function submitSiteIssue(id,note,issue_id){
    setProject(await post(`/api/projects/${state.project.id}/changes/${id}/site-issue`,{
      revision:state.project.revision,note,issue_id
    }));
    notify(issue_id?'已记录处理结果。':'施工问题已提交给项目经理。');
  }
  bindForm('#homeIssue',form=>submitSiteIssue($('#homeIssue').dataset.changeId,form.get('note')));
  document.querySelectorAll('[data-site-issue]').forEach(form=>{
    form.onsubmit=event=>{
      event.preventDefault();
      busy(event.submitter,()=>submitSiteIssue(form.dataset.changeId,new FormData(form).get('note'),form.dataset.siteIssue));
    };
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
  bindForm('#roadshowNote',async form=>{
    const element=$('#roadshowNote');
    const changeId=element.dataset.changeId;
    const text=String(form.get('text')).trim();
    const projectId=state.project.id;
    const result=await post(`/api/projects/${projectId}/changes/${changeId}/schedule/analyze-note`,{text});
    if(!element.isConnected)return;
    state.noteAnalysis={changeId,text,result};
    render();
  });
  bindSchedule();
  bindDemoRoles();
  document.querySelectorAll('[data-review-task]').forEach(link=>link.onclick=event=>{
    event.preventDefault();
    document.getElementById('review-task-'+link.dataset.reviewTask)?.scrollIntoView({block:'start'});
  });
  if($('#accountLogin'))$('#accountLogin').onclick=()=>{state.accountLogin=true;render();};
  document.querySelectorAll('[data-auth]').forEach(button=>button.onclick=()=>{state.register=button.dataset.auth==='register';render();});
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
    state.tab=button.dataset.tab;
    if(change()?.refund&&['schedule','tasks'].includes(state.tab)){
      state.changeId=state.project.data.changes.find(c=>c.kitchen_change||c.tasks.length)?.id||state.changeId;
    }
    state.dirty=false;
    render();
    window.scrollTo(0,0);
  });
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
    const result=await post(`/api/projects/${state.project.id}/changes`,{...Object.fromEntries(form),simple:form.get('simple')==='true',revision:state.project.revision});
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
    await api(`/api/projects/${state.project.id}/changes/${state.changeId}/files`,{method:'POST',body:form});
    notify('资料已上传并留痕；可运行 AI 初审逐条核对。');
  });
  bindForm('#simpleDecision',async (form,event)=>{
    await mutate('feasibility',{decision:event.submitter.value,note:form.get('note'),
      version:change().collaboration.version});
  });
  bindForm('#simplePhoto',async form=>{
    form.set('kind','site');
    form.set('revision',state.project.revision);
    const result=await api(`/api/projects/${state.project.id}/changes/${change().id}/files`,{method:'POST',body:form});
    setProject(result);
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
    if(!$('#guideAction'))$('.schedule-comparison')?.scrollIntoView({block:'start'});
  }
  const draft=state.scheduleDraft?.changeId===c.id&&state.scheduleDraft.revision===state.project.revision?state.scheduleDraft.result:(c.schedule_draft||null);
  const proposal=c.schedule_proposals?.at(-1);
  const guide=$('#guideAction');
  async function previewKitchen(simulate){
    const nodes=(simulate?c.schedule_view.base.nodes:(draft?.nodes||c.schedule_view.base.nodes)).map(n=>({...n}));
    nodes.find(n=>n.id==='materials').start=c.kitchen_change.new_arrival;
    if(simulate)nodes.find(n=>n.id==='preparation').included=false;
    await preview(nodes,simulate?{}:(draft?.fees||{}));
  }
  const simulation=$('#simulateMissingDrawing');
  if(simulation)simulation.onclick=()=>busy(simulation,()=>previewKitchen(true));
  const rehearsal=$('#rehearseApprovals');
  if(rehearsal)rehearsal.onclick=()=>busy(rehearsal,()=>write('rehearse',{proposal_id:proposal.id}));
  if(guide)guide.onclick=()=>busy(guide,async()=>{
    const action=guide.dataset.guide;
    if(action==='check')await previewKitchen(false);
    else if(action==='repair'){
      if(!draft.alternative)throw new Error('暂时没有可行排程，请展开查看冲突。');
      await preview(draft.alternative.nodes,draft.fees);
    }else if(action==='submit'){
      await write('propose',{nodes:draft.nodes,fees:draft.fees,note:'恢复新版图纸核验，按新砖到货日调整施工。'});
    }else if(action==='confirm'){
      await write('decide',{proposal_id:proposal.id,decision:'approve',note:'已核对当前演示版本与本方条件。'});
    }else if(action==='switch'){
      const waiting=Object.keys(proposal.approvers).find(k=>proposal.decisions[k]?.decision!=='approve');
      await enterDemo({design:'designer',construction:'contractor',owner:'owner'}[waiting]);
    }else if(action==='manager')await enterDemo('coordinator');
    else if(action==='publish')await write('publish',{proposal_id:proposal.id});
    else if(action==='tasks')await openTaskPhoto();
  });
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
    notify('正式排程节点已更新。');
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
  try{const result=await api('/api/me');state.roadshow=new URLSearchParams(location.search).get('show')==='1';state.user=result.user;state.csrf=result.csrf;state.demoProfile=result.demo_profile;await refreshProjects();if(state.projects.length&&!location.hash.startsWith('#join=')){await selectProject(state.projects[0].id);return;}}catch{}
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
