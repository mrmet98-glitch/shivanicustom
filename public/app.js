const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const DASHBOARD_STATUSES=['Project Received','Designs Generated','Designs In Review','Project Approved','In Production','Shivani Gems QC','Shipped','Delivered'];
const state = { user:null, projects:[], currentProject:null, statuses:[], dashboardView:'cards', dashboardStatus:'all' };

window.addEventListener('hashchange', renderRoute);
window.addEventListener('DOMContentLoaded', boot);

async function boot(){
  try{
    const me = await api('/api/me');
    state.user = me.user;
    renderRoute();
  }catch(e){ renderLogin(); }
}

async function api(url, options={}){
  const res = await fetch(url, { credentials:'same-origin', ...options });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if(!res.ok){
    if(res.status===401 && url!='/api/login'){ state.user=null; renderLogin(); }
    // Server responses include a generic error plus a useful configuration
    // detail. Prefer the detail for 5xx responses so setup problems are visible
    // on the login screen instead of being reduced to just "Server error".
    const message = res.status>=500 && data?.detail
      ? data.detail
      : data?.error || data?.detail || data || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function renderLogin(){
  app.innerHTML = `<div class="login-wrap"><div class="login-card">
    <div class="brand"><div class="brandmark">SG</div><div class="brandtext"><strong>SHIVANI GEMS</strong><span>Custom Projects</span></div></div>
    <h1>Project Portal</h1><p>Sign in to continue.</p>
    <form id="loginForm" class="form-stack">
      <div class="field"><label>Username</label><input name="username" autocomplete="username" required /></div>
      <div class="field"><label>Passcode</label><input type="password" name="passcode" autocomplete="current-password" required /></div>
      <button class="btn btn-primary" type="submit">Sign In</button><div id="loginError" class="error"></div>
    </form></div></div>`;
  document.querySelector('#loginForm').onsubmit = async (e)=>{
    e.preventDefault(); const fd=new FormData(e.currentTarget); const btn=e.currentTarget.querySelector('button'); btn.disabled=true;
    try{ const r=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))}); state.user=r.user; location.hash=''; await renderRoute(); }
    catch(err){document.querySelector('#loginError').textContent=err.message} finally{btn.disabled=false}
  };
}

function shell(content){
  return `<div class="shell"><header class="topbar">
    <div class="brand"><div class="brandmark">SG</div><div class="brandtext"><strong>SHIVANI GEMS</strong><span>Custom Projects</span></div></div>
    <div class="top-actions"><div class="userpill">${esc(state.user.display_name)} · ${state.user.role==='admin'?'Admin':'Customer'}</div><button id="logoutBtn" class="btn btn-ghost btn-small">Log Out</button></div>
  </header><main class="container">${content}</main></div>`;
}

async function renderRoute(){
  if(!state.user) return renderLogin();
  const hash=location.hash.replace(/^#/,'');
  if(hash.startsWith('/project/')) return renderProject(hash.split('/')[2]);
  return renderDashboard();
}

async function renderDashboard(){
  app.innerHTML=shell(`<div class="loading">Loading projects…</div>`); bindTopbar();
  try{
    const r=await api('/api/projects'); state.projects=r.projects||[];
    renderDashboardContent();
  }catch(e){ app.innerHTML=shell(`<div class="empty">${esc(e.message)}</div>`);bindTopbar(); }
}

function renderDashboardContent(){
  const isAdmin=state.user.role==='admin', filtered=state.dashboardStatus==='all'?state.projects:state.projects.filter(p=>p.status===state.dashboardStatus);
  app.innerHTML=shell(`<section class="hero"><div><div class="eyebrow">${isAdmin?'Admin workspace':'Customer portal'}</div><h1>${isAdmin?'Custom Project Dashboard':'Your Custom Projects'}</h1><p>${isAdmin?'Create projects, add proposals, manage production status and respond to customer comments.':'Review project details, compare proposals, leave feedback and approve your preferred design.'}</p></div>${isAdmin?'<button id="newProjectBtn" class="btn btn-primary">+ New Project</button>':''}</section>
    <section class="dashboard-tools" aria-label="Project view controls"><div class="view-toggle"><button class="btn btn-small ${state.dashboardView==='cards'?'active':''}" data-dashboard-view="cards">Cards</button><button class="btn btn-small ${state.dashboardView==='kanban'?'active':''}" data-dashboard-view="kanban">Timeline / Kanban</button></div><div class="field status-filter"><label for="dashboardStatus">Filter by stage</label><select id="dashboardStatus"><option value="all">All stages (${state.projects.length})</option>${DASHBOARD_STATUSES.map(s=>`<option value="${escAttr(s)}" ${state.dashboardStatus===s?'selected':''}>${esc(s)} (${state.projects.filter(p=>p.status===s).length})</option>`).join('')}</select></div></section>
    ${state.projects.length?(state.dashboardView==='kanban'?kanbanView(filtered):filtered.length?`<div class="grid">${filtered.map(projectCard).join('')}</div>`:`<div class="empty">No projects in this stage.</div>`):`<div class="empty">No projects yet.${isAdmin?' Create the first one to get started.':''}</div>`}`);
  bindTopbar();document.querySelectorAll('[data-project]').forEach(el=>el.onclick=()=>location.hash=`/project/${el.dataset.project}`);
  document.querySelectorAll('[data-dashboard-view]').forEach(el=>el.onclick=()=>{state.dashboardView=el.dataset.dashboardView;renderDashboardContent()});
  document.querySelector('#dashboardStatus').onchange=e=>{state.dashboardStatus=e.target.value;renderDashboardContent()};
  if(isAdmin) document.querySelector('#newProjectBtn').onclick=openNewProjectModal;
}

function kanbanView(projects){
  const stages=state.dashboardStatus==='all'?DASHBOARD_STATUSES:[state.dashboardStatus];
  return `<div class="kanban" aria-label="Projects grouped by stage">${stages.map((status,i)=>{const items=projects.filter(p=>p.status===status);return `<section class="kanban-column tone-${statusTone(status)}"><header><span class="kanban-dot"></span><h2>${esc(status)}</h2><strong>${items.length}</strong></header><div class="kanban-items">${items.length?items.map(kanbanCard).join(''):'<div class="kanban-empty">No projects</div>'}</div></section>`}).join('')}</div>`;
}

function kanbanCard(p){return `<article class="kanban-card" data-project="${p.id}"><h3>${esc(p.name)}</h3><div class="muted">${Number(p.design_count)||0} proposal${Number(p.design_count)===1?'':'s'}</div>${projectNotifications(p)}<div class="kanban-date"><span>Delivery</span><strong>${p.requested_delivery_date?dateOnly(p.requested_delivery_date):'Not set'}</strong></div></article>`}

function projectCard(p){
  return `<article class="project-card" data-project="${p.id}"><div class="card-top"><div><h3>${esc(p.name)}</h3><div class="muted" style="font-size:12px">Created ${dateFmt(p.created_at)}</div></div><span class="status tone-${statusTone(p.status)}">${esc(p.status)}</span></div>
    ${projectNotifications(p)}<div class="meta"><div class="meta-item"><span>Proposals</span><strong>${Number(p.design_count)||0}</strong></div><div class="meta-item"><span>Requested Delivery</span><strong>${p.requested_delivery_date?dateOnly(p.requested_delivery_date):'Not set'}</strong></div></div></article>`;
}

function statusTone(status){return Math.max(0,DASHBOARD_STATUSES.indexOf(status))}
function projectNotifications(p){const comments=Number(p.unseen_comment_count)||0,designs=Number(p.unseen_design_count)||0,updates=Number(p.unseen_update_count)||0;if(!comments&&!designs&&!updates)return'';return `<div class="project-notifications" aria-label="New project activity">${comments?`<div><span class="notification-dot"></span><strong>${comments}</strong> new comment${comments===1?'':'s'} to review</div>`:''}${designs?`<div><span class="notification-dot"></span><strong>${designs}</strong> new design${designs===1?'':'s'} to review</div>`:''}${updates?`<div><span class="notification-dot"></span><strong>${updates}</strong> project update${updates===1?'':'s'} to review</div>`:''}</div>`}

async function renderProject(id){
  app.innerHTML=shell(`<div class="loading">Loading project…</div>`);bindTopbar();
  try{
    const r=await api(`/api/projects/${encodeURIComponent(id)}`); state.currentProject=r; state.statuses=r.statuses||[];
    const p=r.project,isAdmin=state.user.role==='admin',approved=!!p.approved_design_id;
    const designs=[...(r.designs||[])].sort((a,b)=>(b.approved||0)-(a.approved||0));
    app.innerHTML=shell(`
      <div class="crumb" id="backDash">← Back to projects</div>
      <div class="project-head"><div><div class="eyebrow">${esc(p.project_type||'Custom Jewelry Project')}</div><h1>${esc(p.name)}</h1><div class="muted">Created ${dateFmt(p.created_at)}${p.client_reference?` · Ref ${esc(p.client_reference)}`:''}</div></div>
      <div style="display:flex;gap:9px;flex-wrap:wrap">${isAdmin?'<button id="deleteProjectBtn" class="btn btn-danger">Delete Project</button><button id="editProjectBtn" class="btn btn-ghost">Edit Project</button><button id="addDesignBtn" class="btn btn-primary">+ Add Proposal</button>':`<span class="status tone-${statusTone(p.status)}">${esc(p.status)}</span>`}</div></div>

      <section class="panel"><div class="panel-title"><h2>Project Progress</h2>${isAdmin?statusSelect(p):''}</div>${tracker(p.status)}</section>

      <section class="panel"><div class="panel-title"><h2>Project Details</h2></div>
        <div class="project-specs">${spec('Metal',p.metal)}${spec('Requested Delivery',p.requested_delivery_date?dateOnly(p.requested_delivery_date):'—')}${spec('Size / Dimensions',p.size_details)}${spec('Project Type',p.project_type)}${spec('Supplied Stones / Materials',p.supplied_materials)}${isAdmin?spec('Internal Notes',p.internal_notes):''}</div>
        ${p.details?`<div style="margin-top:18px"><div class="eyebrow">Project Brief</div><div class="copy" style="margin-top:8px">${esc(p.details)}</div></div>`:''}
      </section>

      ${(r.reference_files||[]).length?`<section class="panel"><details class="gallery-details"><summary>Reference Images · ${(r.reference_files||[]).length} file${r.reference_files.length===1?'':'s'}</summary><div class="gallery">${r.reference_files.map(f=>imageTag(f,'Reference image')).join('')}</div></details></section>`:''}

      <section class="panel"><div class="panel-title"><h2>Design Proposals</h2><span class="muted">${designs.length} proposal${designs.length===1?'':'s'}</span></div>
        ${designs.length?`<div class="design-list">${designs.map((d,i)=>designCard(d,{approvedProject:approved,initialOpen:isAdmin?false:(!approved&&i===0)||d.approved})).join('')}</div>`:`<div class="empty">No proposals have been added yet.</div>`}
      </section>`);
    bindTopbar(); bindProjectEvents(p,designs);
  }catch(e){ app.innerHTML=shell(`<div class="crumb" onclick="location.hash=''">← Back</div><div class="empty">${esc(e.message)}</div>`);bindTopbar(); }
}

function statusSelect(p){return `<select id="statusSelect" style="background:#081a2e;color:white;border:1px solid var(--line);border-radius:9px;padding:8px 10px">${state.statuses.map(s=>`<option ${s===p.status?'selected':''}>${esc(s)}</option>`).join('')}</select>`}
function tracker(current){const ix=Math.max(0,state.statuses.indexOf(current));return `<div class="tracker">${state.statuses.map((s,i)=>`<div class="track-step ${i<ix?'done':i===ix?'active':''}">${esc(s)}</div>`).join('')}</div>`}
function spec(label,val){if(!val)return'';return `<div class="spec"><span>${esc(label)}</span><strong>${esc(val)}</strong></div>`}

function designCard(d,{approvedProject,initialOpen}){
  const suppress=approvedProject&&!d.approved&&state.user.role==='customer';
  const rejected=d.review_status==='rejected', reviewed=d.review_status==='reviewed';
  const img=!suppress&&d.thumbnail_file_id?`<img class="thumb" src="/api/files/${d.thumbnail_file_id}" alt="${escAttr(d.title)}" />`:'';
  return `<article class="design-card ${d.approved?'approved':''} ${rejected?'rejected':''}" data-design-card="${d.id}">
    <div class="design-summary ${img?'':'no-image'}" data-toggle-design="${d.id}">${img}<div>${d.approved?'<div class="approved-ribbon">✓ Approved Design</div>':rejected?'<div class="rejected-ribbon">Rejected · Sunsetted</div>':reviewed?'<div class="reviewed-ribbon">✓ Reviewed</div>':''}<h3>${esc(d.title)}</h3><div class="design-meta"><span class="chip">${esc(d.metal||'Metal not listed')}</span><span class="chip">${num(d.total_ctw,2)} ctw</span><span class="chip">${Number(d.comment_count)||0} comments</span>${suppress?'<span class="chip">Collapsed after approval</span>':''}</div></div>${priceHtml(d)}</div>
    <div id="design-detail-${d.id}" class="design-detail ${initialOpen&&!suppress&&!rejected?'':'hidden'}">${suppress?'<div class="muted">Another design has been approved. Expand to review this proposal.</div>':'<div class="loading">Loading proposal…</div>'}</div>
  </article>`;
}

function bindProjectEvents(project, designs){
  document.querySelector('#backDash').onclick=()=>location.hash='';
  if(state.user.role==='admin'){
    document.querySelector('#addDesignBtn').onclick=()=>openDesignModal(project.id);
    document.querySelector('#editProjectBtn').onclick=()=>openEditProjectModal(project);
    document.querySelector('#deleteProjectBtn').onclick=async()=>{if(!confirm(`Permanently delete “${project.name}” and all of its proposals, comments, and files? This cannot be undone.`))return;const btn=document.querySelector('#deleteProjectBtn');btn.disabled=true;try{const r=await api(`/api/projects/${encodeURIComponent(project.id)}`,{method:'DELETE'});location.hash='';toast(r.storage_warning?'Project deleted, but some stored files could not be cleaned up.':'Project deleted');await renderDashboard()}catch(err){toast(err.message);btn.disabled=false}};
    document.querySelector('#statusSelect').onchange=async(e)=>{const v=e.target.value;e.target.disabled=true;try{const r=await api(`/api/projects/${project.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:v})});toast(notificationMessage('Project status updated',r));renderProject(project.id)}catch(err){toast(err.message)}finally{e.target.disabled=false}};
  }
  document.querySelectorAll('[data-toggle-design]').forEach(el=>el.onclick=async()=>{
    const id=el.dataset.toggleDesign, box=document.querySelector(`#design-detail-${id}`);
    if(box.dataset.loaded==='1'){box.classList.toggle('hidden');return}
    box.classList.remove('hidden'); await loadDesignDetail(id,box);
  });
  document.querySelectorAll('.design-detail:not(.hidden)').forEach(async box=>{
    const id=box.id.replace('design-detail-',''); if(!box.textContent.includes('Collapsed after approval')) await loadDesignDetail(id,box);
  });
  bindLightbox();
}

async function loadDesignDetail(id,box){
  box.innerHTML='<div class="loading">Loading proposal…</div>';
  try{const r=await api(`/api/designs/${id}`);box.dataset.loaded='1';box.innerHTML=designDetailHtml(r.design);bindDesignDetailEvents(r.design,box)}catch(e){box.innerHTML=`<div class="error">${esc(e.message)}</div>`}
}

function designDetailHtml(d){
  const files=d.files||[], diamonds=d.diamonds||[], findings=d.findings||[], isCustomer=state.user.role==='customer', isAdmin=state.user.role==='admin';
  return `${files.length?`<div class="design-images"><img class="main-image js-main-image" src="/api/files/${files[0].id}" alt="${escAttr(d.title)}"><div class="side-thumbs">${files.map(f=>`<img src="/api/files/${f.id}" data-thumb-src="/api/files/${f.id}" alt="${escAttr(f.filename)}">`).join('')}</div></div>`:''}
    <div class="detail-grid"><div><div class="eyebrow">Proposal Details</div>${d.description?`<div class="copy" style="margin:8px 0 15px">${esc(d.description)}</div>`:''}
      <div class="project-specs" style="grid-template-columns:1fr 1fr;margin-bottom:16px">${spec('Metal',d.metal)}${spec('Total Diamond Weight',`${num(d.total_ctw,2)} ctw`)}</div>
      ${diamonds.length?`<table class="diamond-table"><thead><tr><th>Shape</th><th>Weight</th><th>#</th><th>Color / Clarity</th><th>Origin</th><th>Measurements</th></tr></thead><tbody>${diamonds.map(x=>`<tr><td>${esc(x.shape||'—')}</td><td>${x.weight_ct==null?'—':`${num(x.weight_ct,3)} ct${x.weight_mode==='each'?' ea.':''}`}</td><td>${x.stone_count||1}</td><td>${esc(x.color_clarity||'—')}</td><td>${esc(x.diamond_origin||'—')}</td><td>${esc(x.measurements||'—')}</td></tr>`).join('')}</tbody></table>`:'<div class="muted">No diamond lines entered.</div>'}
      <div class="eyebrow findings-heading">Findings</div>${findings.length?`<table class="diamond-table"><thead><tr><th>Description</th><th>Type</th><th>Metal</th></tr></thead><tbody>${findings.map(x=>`<tr><td>${esc(x.description||'—')}</td><td>${esc(x.finding_type||'Other')}</td><td>${esc(x.metal||'—')}</td></tr>`).join('')}</tbody></table>`:'<div class="muted">No findings entered.</div>'}
    </div><div><div class="eyebrow">Discussion</div><div class="comments" style="margin-top:9px">${(d.comments||[]).length?d.comments.map(commentHtml).join(''):'<div class="muted">No comments yet.</div>'}</div><form class="comment-form" data-comment-form="${d.id}"><textarea placeholder="Add an edit request, question or response…" required></textarea><button class="btn btn-ghost btn-small" type="submit">Send</button></form>
    ${isAdmin?`<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><button class="btn btn-ghost btn-small" data-edit-design="${d.id}">Edit Proposal</button><div class="helper">Approved proposals can also be edited.</div></div>`:''}${isCustomer&&!d.approved&&d.review_status!=='rejected'?`<div class="review-actions"><button class="btn btn-primary" data-approve="${d.id}">Approve This Design</button>${d.review_status!=='reviewed'?`<button class="btn btn-ghost btn-small" data-review-design="reviewed">Mark as Reviewed</button>`:'<span class="reviewed-confirmation">✓ You marked this design reviewed</span>'}<button class="btn btn-reject btn-small" data-review-design="rejected">Reject Proposal</button><div class="helper">Rejected proposals remain available but are sunsetted and collapsed.</div></div>`:''}${d.review_status==='rejected'?'<div class="rejected-confirmation">This proposal has been rejected and sunsetted.</div>':''}${d.approved?'<div style="margin-top:14px;color:#b8e4c9;font-weight:800">✓ This design is approved for the project.</div>':''}</div></div>`;
}
function commentHtml(c){return `<div class="comment ${c.role}"><div class="comment-head"><strong>${esc(c.display_name)}</strong><span>${dateTimeFmt(c.created_at)}</span></div><p>${esc(c.body)}</p></div>`}

function bindDesignDetailEvents(d,box){
  box.querySelectorAll('[data-thumb-src]').forEach(t=>t.onclick=()=>{box.querySelector('.js-main-image').src=t.dataset.thumbSrc});
  const form=box.querySelector('[data-comment-form]'); if(form) form.onsubmit=async e=>{e.preventDefault();const ta=form.querySelector('textarea'),btn=form.querySelector('button');btn.disabled=true;try{const r=await api(`/api/designs/${d.id}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:ta.value})});toast(notificationMessage('Comment added',r));await loadDesignDetail(d.id,box)}catch(err){toast(err.message)}finally{btn.disabled=false}};
  const approve=box.querySelector('[data-approve]'); if(approve) approve.onclick=async()=>{if(!confirm(`Approve “${d.title}” as the production design?`))return;approve.disabled=true;try{const r=await api(`/api/designs/${d.id}/approve`,{method:'POST'});toast(notificationMessage('Design approved',r));await renderProject(d.project_id)}catch(err){toast(err.message);approve.disabled=false}};
  const edit=box.querySelector('[data-edit-design]'); if(edit) edit.onclick=()=>openEditDesignModal(d);
  box.querySelectorAll('[data-review-design]').forEach(btn=>btn.onclick=async()=>{const status=btn.dataset.reviewDesign;if(status==='rejected'&&!confirm(`Reject “${d.title}”? It will remain available in a collapsed, sunsetted state.`))return;box.querySelectorAll('[data-review-design]').forEach(x=>x.disabled=true);try{await api(`/api/designs/${d.id}/review`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});toast(status==='rejected'?'Proposal rejected':'Proposal marked reviewed');await renderProject(d.project_id)}catch(err){toast(err.message);box.querySelectorAll('[data-review-design]').forEach(x=>x.disabled=false)}});
  bindLightbox(box);
}

function openNewProjectModal(){
  openModal(`<div class="modal-head"><h2>Create New Project</h2><button class="btn btn-ghost btn-small" data-close>Close</button></div><form id="newProjectForm" class="form-grid">
    ${input('Project Name','name',true)}${input('Project Type','project_type',false,'e.g. Engagement Ring, Pendant, Band')}
    ${input('Client / PO Reference','client_reference',false,'Optional internal/customer reference')}${input('Requested / Expected Delivery','requested_delivery_date',false,'','date')}
    ${input('Metal','metal',false,'Free text — e.g. 14K Yellow Gold')}${input('Size / Dimensions','size_details',false,'e.g. Ring size 7, pendant 18mm')}
    <div class="field span-2"><label>Project Details</label><textarea name="details" placeholder="Full brief, stone specs, design direction, special instructions…"></textarea></div>
    <div class="field span-2"><label>Supplied Stones / Materials</label><textarea name="supplied_materials" placeholder="Anything being supplied by customer or Shivani Gems"></textarea></div>
    <div class="field span-2"><label>Reference Images</label><input type="file" name="reference_images" multiple accept="image/*,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP"/><div class="helper">Multiple files allowed. Files are stored privately in R2.</div></div>
    <div class="field span-2"><label>Internal Notes (admin only)</label><textarea name="internal_notes" placeholder="Not visible to customer"></textarea></div>
    <div class="modal-actions span-2"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Create Project</button></div></form>`);
  document.querySelector('#newProjectForm').onsubmit=async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;try{const r=await api('/api/projects',{method:'POST',body:new FormData(e.currentTarget)});closeModal();toast('Project created');location.hash=`/project/${r.project.id}`}catch(err){toast(err.message);btn.disabled=false}};
}

function openEditProjectModal(p){
  openModal(`<div class="modal-head"><h2>Edit Project</h2><button class="btn btn-ghost btn-small" data-close>Close</button></div><form id="editProjectForm" class="form-grid">
    ${input('Project Name','name',true,'','text',p.name)}${input('Project Type','project_type',false,'','text',p.project_type)}${input('Client / PO Reference','client_reference',false,'','text',p.client_reference)}${input('Requested / Expected Delivery','requested_delivery_date',false,'','date',p.requested_delivery_date)}${input('Metal','metal',false,'','text',p.metal)}${input('Size / Dimensions','size_details',false,'','text',p.size_details)}
    ${textarea('Project Details','details',p.details)}${textarea('Supplied Stones / Materials','supplied_materials',p.supplied_materials)}${textarea('Internal Notes (admin only)','internal_notes',p.internal_notes)}
    <div class="modal-actions span-2"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save Changes</button></div></form>`);
  document.querySelector('#editProjectForm').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{await api(`/api/projects/${p.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});closeModal();toast('Project updated');renderProject(p.id)}catch(err){toast(err.message)}};
}

function openDesignModal(projectId){
  openProposalModal({projectId});
}

function openEditDesignModal(design){
  openProposalModal({projectId:design.project_id,design});
}

function openProposalModal({projectId,design=null}){
  const editing=!!design, d=design||{}, existingDesigns=(state.currentProject?.designs||[]).filter(x=>x.id&&x.id!==d.id);
  openModal(`<div class="modal-head"><h2>${editing?'Edit':'Add'} Design Proposal</h2><button class="btn btn-ghost btn-small" data-close>Close</button></div><form id="designForm" class="form-grid">
    ${input('Proposal Name','title',true,'e.g. Design A — East-West Bezel','text',d.title)}${input('Metal','metal',false,'Free text','text',d.metal)}${input('Finished Piece Price','price',false,'Leave blank if quote is pending','number',Number(d.has_price)===0?'':editing?(Number(d.price_cents)||0)/100:'')}
    <div class="field"><label class="check-label quote-check"><input type="checkbox" name="price_includes_diamonds" ${Number(d.price_includes_diamonds)===1?'checked':''}> Quote includes Shivani-provided diamonds</label><label class="check-label quote-check"><input type="checkbox" name="price_includes_findings" ${Number(d.price_includes_findings)===1?'checked':''}> Quote includes cost of chain/findings</label><div class="helper">Shown beneath the price to the customer.</div></div>
    <div class="field span-2"><label>Proposal Notes</label><textarea name="description" placeholder="Customer-facing notes about this design">${esc(d.description||'')}</textarea></div>
    <div class="field span-2"><label>${editing?'Add ':''}Design Images</label><input type="file" name="design_images" multiple ${editing?'':'required'} accept="image/*,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP"><div class="helper">${editing?'Existing images remain; selected images are added.':'The first image becomes the card thumbnail.'}</div></div>
    <div class="span-2"><div class="panel-title line-heading"><div class="eyebrow">Diamond Information</div><button type="button" id="addDiamondRow" class="btn btn-ghost btn-small">+ Add Diamond Line</button></div>
      ${!editing&&existingDesigns.length?`<div class="field copy-diamonds"><label>Copy diamond info from another proposal</label><select id="copyDiamondSource"><option value="">Choose a proposal…</option>${existingDesigns.map(x=>`<option value="${escAttr(x.id)}">${esc(x.title)}</option>`).join('')}</select></div>`:''}<div id="diamondRows" class="form-stack"></div></div>
    <div class="span-2"><div class="panel-title line-heading"><div class="eyebrow">Findings</div><button type="button" id="addFindingRow" class="btn btn-ghost btn-small">+ Add Finding</button></div><div id="findingRows" class="form-stack"></div></div>
    <input type="hidden" name="diamonds" id="diamondsJson"><input type="hidden" name="findings" id="findingsJson"><div class="modal-actions span-2"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${editing?'Save Changes':'Add Proposal'}</button></div></form>`);
  const rows=document.querySelector('#diamondRows'), findingRows=document.querySelector('#findingRows');
  (d.diamonds||[{}]).forEach(x=>addDiamondRow(rows,x)); (d.findings||[{}]).forEach(x=>addFindingRow(findingRows,x));
  document.querySelector('#addDiamondRow').onclick=()=>addDiamondRow(rows); document.querySelector('#addFindingRow').onclick=()=>addFindingRow(findingRows);
  const copySource=document.querySelector('#copyDiamondSource');if(copySource)copySource.onchange=async()=>{if(!copySource.value)return;try{const r=await api(`/api/designs/${encodeURIComponent(copySource.value)}`);rows.innerHTML='';(r.design.diamonds||[{}]).forEach(x=>addDiamondRow(rows,x));toast('Diamond info copied')}catch(err){toast(err.message)}finally{copySource.value=''}};
  document.querySelector('#designForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const diamonds=[...rows.querySelectorAll('.diamond-row')].map(row=>Object.fromEntries(new FormData(row))).map(x=>({...x,stone_count:Number(x.stone_count||1),weight_ct:x.weight_ct===''?null:Number(x.weight_ct)}));const findings=[...findingRows.querySelectorAll('.finding-row')].map(row=>Object.fromEntries(new FormData(row)));form.querySelector('#diamondsJson').value=JSON.stringify(diamonds);form.querySelector('#findingsJson').value=JSON.stringify(findings);const btn=form.querySelector('[type=submit]');btn.disabled=true;try{await api(editing?`/api/designs/${d.id}`:`/api/projects/${projectId}/designs`,{method:editing?'PATCH':'POST',body:new FormData(form)});closeModal();toast(editing?'Proposal updated':'Proposal added');renderProject(projectId)}catch(err){toast(err.message);btn.disabled=false}};
}

function addFindingRow(parent,values={}){
  const row=document.createElement('form');row.className='finding-row';row.innerHTML=`${mini('Description','description','Main finding details','text',values.description)}<div class="field"><label>Type</label><select name="finding_type">${['Chain','Earring Backs','Other'].map(x=>`<option ${values.finding_type===x?'selected':''}>${x}</option>`).join('')}</select></div>${mini('Metal','metal','e.g. 14K Yellow Gold','text',values.metal)}<button type="button" class="icon-btn" title="Remove">×</button>`;row.querySelector('.icon-btn').onclick=()=>row.remove();parent.appendChild(row)
}

function addDiamondRow(parent,values={}){
  const row=document.createElement('form');row.className='diamond-row';row.innerHTML=`
    ${mini('Shape','shape','e.g. Round','text',values.shape)}${mini('Weight (ct)','weight_ct','','number',values.weight_ct)}
    <div class="field"><label>Weight means</label><select name="weight_mode"><option value="total" ${values.weight_mode==='each'?'':'selected'}>Total line</option><option value="each" ${values.weight_mode==='each'?'selected':''}>Each stone</option></select></div>
    ${mini('# Stones','stone_count','1','number',values.stone_count||1)}${mini('Color / Clarity','color_clarity','e.g. G-H VS','text',values.color_clarity)}
    <div class="field"><label>Origin</label><select name="diamond_origin"><option value="">Not specified</option><option ${values.diamond_origin==='Natural'?'selected':''}>Natural</option><option value="Lab Grown" ${values.diamond_origin==='Lab Grown'?'selected':''}>Lab Grown</option></select></div>
    ${mini('Measurements','measurements','e.g. 5.00mm','text',values.measurements)}<button type="button" class="icon-btn" title="Remove">×</button>`;row.querySelector('.icon-btn').onclick=()=>row.remove();parent.appendChild(row)
}

function input(label,name,required=false,placeholder='',type='text',value=''){return `<div class="field"><label>${esc(label)}</label><input type="${type}" name="${name}" ${required?'required':''} ${type==='number'?'step="0.01" min="0"':''} placeholder="${escAttr(placeholder)}" value="${escAttr(value||'')}"></div>`}
function mini(label,name,placeholder='',type='text',value=''){return `<div class="field"><label>${esc(label)}</label><input type="${type}" name="${name}" ${type==='number'?'step="0.001" min="0"':''} placeholder="${escAttr(placeholder)}" value="${escAttr(value??'')}"></div>`}
function textarea(label,name,value=''){return `<div class="field span-2"><label>${esc(label)}</label><textarea name="${name}">${esc(value||'')}</textarea></div>`}

function openModal(html){const d=document.createElement('div');d.className='modal-backdrop';d.id='modalBackdrop';d.innerHTML=`<div class="modal">${html}</div>`;document.body.appendChild(d);d.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeModal);d.onclick=e=>{if(e.target===d)closeModal()}}
function closeModal(){document.querySelector('#modalBackdrop')?.remove()}
function bindTopbar(){document.querySelector('#logoutBtn')?.addEventListener('click',async()=>{await api('/api/logout',{method:'POST'}).catch(()=>{});state.user=null;location.hash='';renderLogin()})}
function imageTag(f,alt){return `<img src="/api/files/${f.id}" alt="${escAttr(alt)}" data-lightbox="/api/files/${f.id}">`}
function bindLightbox(root=document){root.querySelectorAll('[data-lightbox],.gallery img').forEach(img=>img.onclick=()=>{const src=img.dataset.lightbox||img.src;const l=document.createElement('div');l.className='lightbox';l.innerHTML=`<img src="${src}">`;l.onclick=()=>l.remove();document.body.appendChild(l)})}
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');clearTimeout(window.__toastT);window.__toastT=setTimeout(()=>toastEl.classList.remove('show'),String(msg).includes('HubSpot failed')?10000:2600)}
function notificationMessage(success,response){return response?.notification_warning?`${success}, but HubSpot failed: ${response.notification_warning}`:success}
function money(cents){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100)}
function priceHtml(d){return `<div class="price-wrap"><div class="price">${Number(d.has_price)===0?'Quote pending':money(d.price_cents)}</div>${Number(d.has_price)!==0&&Number(d.price_includes_diamonds)===1?'<div class="price-note">Includes Shivani-provided diamonds</div>':''}${Number(d.has_price)!==0&&Number(d.price_includes_findings)===1?'<div class="price-note">Includes cost of chain/findings</div>':''}</div>`}
function num(n,d=2){return Number(n||0).toFixed(d).replace(/\.?0+$/,'')}
function dateFmt(s){if(!s)return'—';const d=new Date(s.endsWith?.('Z')||s.includes('T')?s:s.replace(' ','T')+'Z');return Number.isNaN(d)?s:new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(d)}
function dateTimeFmt(s){if(!s)return'—';const d=new Date(s.endsWith?.('Z')||s.includes('T')?s:s.replace(' ','T')+'Z');return Number.isNaN(d)?s:new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d)}
function dateOnly(s){if(!s)return'—';const [y,m,d]=String(s).slice(0,10).split('-').map(Number);return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(y,m-1,d))}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function escAttr(v){return esc(v).replace(/`/g,'&#096;')}
