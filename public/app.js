const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const state = { user:null, projects:[], currentProject:null, statuses:[] };

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
    const isAdmin=state.user.role==='admin';
    app.innerHTML=shell(`<section class="hero"><div><div class="eyebrow">${isAdmin?'Admin workspace':'Customer portal'}</div><h1>${isAdmin?'Custom Project Dashboard':'Your Custom Projects'}</h1><p>${isAdmin?'Create projects, add proposals, manage production status and respond to customer comments.':'Review project details, compare proposals, leave feedback and approve your preferred design.'}</p></div>${isAdmin?'<button id="newProjectBtn" class="btn btn-primary">+ New Project</button>':''}</section>
      ${state.projects.length?`<div class="grid">${state.projects.map(projectCard).join('')}</div>`:`<div class="empty">No projects yet.${isAdmin?' Create the first one to get started.':''}</div>`}`);
    bindTopbar();
    document.querySelectorAll('[data-project]').forEach(el=>el.onclick=()=>location.hash=`/project/${el.dataset.project}`);
    if(isAdmin) document.querySelector('#newProjectBtn').onclick=openNewProjectModal;
  }catch(e){ app.innerHTML=shell(`<div class="empty">${esc(e.message)}</div>`);bindTopbar(); }
}

function projectCard(p){
  return `<article class="project-card" data-project="${p.id}"><div class="card-top"><div><h3>${esc(p.name)}</h3><div class="muted" style="font-size:12px">Created ${dateFmt(p.created_at)}</div></div><span class="status">${esc(p.status)}</span></div>
    <div class="meta"><div class="meta-item"><span>Proposals</span><strong>${Number(p.design_count)||0}</strong></div><div class="meta-item"><span>Requested Delivery</span><strong>${p.requested_delivery_date?dateOnly(p.requested_delivery_date):'Not set'}</strong></div></div></article>`;
}

async function renderProject(id){
  app.innerHTML=shell(`<div class="loading">Loading project…</div>`);bindTopbar();
  try{
    const r=await api(`/api/projects/${encodeURIComponent(id)}`); state.currentProject=r; state.statuses=r.statuses||[];
    const p=r.project,isAdmin=state.user.role==='admin',approved=!!p.approved_design_id;
    const designs=[...(r.designs||[])].sort((a,b)=>(b.approved||0)-(a.approved||0));
    app.innerHTML=shell(`
      <div class="crumb" id="backDash">← Back to projects</div>
      <div class="project-head"><div><div class="eyebrow">${esc(p.project_type||'Custom Jewelry Project')}</div><h1>${esc(p.name)}</h1><div class="muted">Created ${dateFmt(p.created_at)}${p.client_reference?` · Ref ${esc(p.client_reference)}`:''}</div></div>
      <div style="display:flex;gap:9px;flex-wrap:wrap">${isAdmin?'<button id="editProjectBtn" class="btn btn-ghost">Edit Project</button><button id="addDesignBtn" class="btn btn-primary">+ Add Proposal</button>':`<span class="status">${esc(p.status)}</span>`}</div></div>

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
  const img=!suppress&&d.thumbnail_file_id?`<img class="thumb" src="/api/files/${d.thumbnail_file_id}" alt="${escAttr(d.title)}" />`:'';
  return `<article class="design-card ${d.approved?'approved':''}" data-design-card="${d.id}">
    <div class="design-summary ${img?'':'no-image'}" data-toggle-design="${d.id}">${img}<div>${d.approved?'<div class="approved-ribbon">✓ Approved Design</div>':''}<h3>${esc(d.title)}</h3><div class="design-meta"><span class="chip">${esc(d.metal||'Metal not listed')}</span><span class="chip">${num(d.total_ctw,2)} ctw</span><span class="chip">${Number(d.comment_count)||0} comments</span>${suppress?'<span class="chip">Collapsed after approval</span>':''}</div></div><div class="price">${money(d.price_cents)}</div></div>
    <div id="design-detail-${d.id}" class="design-detail ${initialOpen&&!suppress?'':'hidden'}">${suppress?'<div class="muted">Another design has been approved. Expand to review this proposal.</div>':'<div class="loading">Loading proposal…</div>'}</div>
  </article>`;
}

function bindProjectEvents(project, designs){
  document.querySelector('#backDash').onclick=()=>location.hash='';
  if(state.user.role==='admin'){
    document.querySelector('#addDesignBtn').onclick=()=>openDesignModal(project.id);
    document.querySelector('#editProjectBtn').onclick=()=>openEditProjectModal(project);
    document.querySelector('#statusSelect').onchange=async(e)=>{const v=e.target.value;e.target.disabled=true;try{await api(`/api/projects/${project.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:v})});toast('Project status updated');renderProject(project.id)}catch(err){toast(err.message)}finally{e.target.disabled=false}};
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
  const files=d.files||[], diamonds=d.diamonds||[], isCustomer=state.user.role==='customer';
  return `${files.length?`<div class="design-images"><img class="main-image js-main-image" src="/api/files/${files[0].id}" alt="${escAttr(d.title)}"><div class="side-thumbs">${files.map(f=>`<img src="/api/files/${f.id}" data-thumb-src="/api/files/${f.id}" alt="${escAttr(f.filename)}">`).join('')}</div></div>`:''}
    <div class="detail-grid"><div><div class="eyebrow">Proposal Details</div>${d.description?`<div class="copy" style="margin:8px 0 15px">${esc(d.description)}</div>`:''}
      <div class="project-specs" style="grid-template-columns:1fr 1fr;margin-bottom:16px">${spec('Metal',d.metal)}${spec('Total Diamond Weight',`${num(d.total_ctw,2)} ctw`)}</div>
      ${diamonds.length?`<table class="diamond-table"><thead><tr><th>Shape</th><th>Weight</th><th>#</th><th>Color / Clarity</th><th>Measurements</th></tr></thead><tbody>${diamonds.map(x=>`<tr><td>${esc(x.shape||'—')}</td><td>${x.weight_ct==null?'—':`${num(x.weight_ct,3)} ct${x.weight_mode==='each'?' ea.':''}`}</td><td>${x.stone_count||1}</td><td>${esc(x.color_clarity||'—')}</td><td>${esc(x.measurements||'—')}</td></tr>`).join('')}</tbody></table>`:'<div class="muted">No diamond lines entered.</div>'}
    </div><div><div class="eyebrow">Discussion</div><div class="comments" style="margin-top:9px">${(d.comments||[]).length?d.comments.map(commentHtml).join(''):'<div class="muted">No comments yet.</div>'}</div><form class="comment-form" data-comment-form="${d.id}"><textarea placeholder="Add an edit request, question or response…" required></textarea><button class="btn btn-ghost btn-small" type="submit">Send</button></form>
    ${isCustomer&&!d.approved?`<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><button class="btn btn-primary" data-approve="${d.id}">Approve This Design</button><div class="helper">Approval will mark the project approved and make this the selected production design.</div></div>`:''}${d.approved?'<div style="margin-top:14px;color:#b8e4c9;font-weight:800">✓ This design is approved for the project.</div>':''}</div></div>`;
}
function commentHtml(c){return `<div class="comment ${c.role}"><div class="comment-head"><strong>${esc(c.display_name)}</strong><span>${dateFmt(c.created_at)}</span></div><p>${esc(c.body)}</p></div>`}

function bindDesignDetailEvents(d,box){
  box.querySelectorAll('[data-thumb-src]').forEach(t=>t.onclick=()=>{box.querySelector('.js-main-image').src=t.dataset.thumbSrc});
  const form=box.querySelector('[data-comment-form]'); if(form) form.onsubmit=async e=>{e.preventDefault();const ta=form.querySelector('textarea'),btn=form.querySelector('button');btn.disabled=true;try{await api(`/api/designs/${d.id}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:ta.value})});toast('Comment added');await loadDesignDetail(d.id,box)}catch(err){toast(err.message)}finally{btn.disabled=false}};
  const approve=box.querySelector('[data-approve]'); if(approve) approve.onclick=async()=>{if(!confirm(`Approve “${d.title}” as the production design?`))return;approve.disabled=true;try{await api(`/api/designs/${d.id}/approve`,{method:'POST'});toast('Design approved');await renderProject(d.project_id)}catch(err){toast(err.message);approve.disabled=false}};
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
  openModal(`<div class="modal-head"><h2>Add Design Proposal</h2><button class="btn btn-ghost btn-small" data-close>Close</button></div><form id="designForm" class="form-grid">
    ${input('Proposal Name','title',true,'e.g. Design A — East-West Bezel')}${input('Metal','metal',false,'Free text')}${input('Finished Piece Price','price',true,'0.00','number')}
    <div class="field span-2"><label>Proposal Notes</label><textarea name="description" placeholder="Customer-facing notes about this design"></textarea></div>
    <div class="field span-2"><label>Design Images</label><input type="file" name="design_images" multiple required accept="image/*,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP"><div class="helper">The first image becomes the card thumbnail. Add multiple views/renders if needed.</div></div>
    <div class="span-2"><div class="panel-title" style="margin:8px 0"><div><div class="eyebrow">Diamond Information</div></div><button type="button" id="addDiamondRow" class="btn btn-ghost btn-small">+ Add Diamond Line</button></div><div id="diamondRows" class="form-stack"></div></div>
    <input type="hidden" name="diamonds" id="diamondsJson"><div class="modal-actions span-2"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Add Proposal</button></div></form>`);
  const rows=document.querySelector('#diamondRows');document.querySelector('#addDiamondRow').onclick=()=>addDiamondRow(rows);addDiamondRow(rows);
  document.querySelector('#designForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const diamonds=[...rows.querySelectorAll('.diamond-row')].map(row=>Object.fromEntries(new FormData(row))).map(d=>({...d,stone_count:Number(d.stone_count||1),weight_ct:d.weight_ct===''?null:Number(d.weight_ct)}));form.querySelector('#diamondsJson').value=JSON.stringify(diamonds);const btn=form.querySelector('[type=submit]');btn.disabled=true;try{await api(`/api/projects/${projectId}/designs`,{method:'POST',body:new FormData(form)});closeModal();toast('Proposal added');renderProject(projectId)}catch(err){toast(err.message);btn.disabled=false}};
}

function addDiamondRow(parent){
  const row=document.createElement('form');row.className='diamond-row';row.innerHTML=`${mini('Shape','shape','e.g. Round')}${mini('Weight (ct)','weight_ct','','number')}<div class="field"><label>Weight means</label><select name="weight_mode"><option value="total">Total line</option><option value="each">Each stone</option></select></div>${mini('# Stones','stone_count','1','number')}${mini('Color / Clarity','color_clarity','e.g. G-H VS')}${mini('Measurements','measurements','e.g. 5.00mm')}<button type="button" class="icon-btn" title="Remove">×</button>`;row.querySelector('.icon-btn').onclick=()=>row.remove();parent.appendChild(row)
}

function input(label,name,required=false,placeholder='',type='text',value=''){return `<div class="field"><label>${esc(label)}</label><input type="${type}" name="${name}" ${required?'required':''} ${type==='number'?'step="0.01" min="0"':''} placeholder="${escAttr(placeholder)}" value="${escAttr(value||'')}"></div>`}
function mini(label,name,placeholder='',type='text'){return `<div class="field"><label>${esc(label)}</label><input type="${type}" name="${name}" ${type==='number'?'step="0.001" min="0"':''} placeholder="${escAttr(placeholder)}"></div>`}
function textarea(label,name,value=''){return `<div class="field span-2"><label>${esc(label)}</label><textarea name="${name}">${esc(value||'')}</textarea></div>`}

function openModal(html){const d=document.createElement('div');d.className='modal-backdrop';d.id='modalBackdrop';d.innerHTML=`<div class="modal">${html}</div>`;document.body.appendChild(d);d.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeModal);d.onclick=e=>{if(e.target===d)closeModal()}}
function closeModal(){document.querySelector('#modalBackdrop')?.remove()}
function bindTopbar(){document.querySelector('#logoutBtn')?.addEventListener('click',async()=>{await api('/api/logout',{method:'POST'}).catch(()=>{});state.user=null;location.hash='';renderLogin()})}
function imageTag(f,alt){return `<img src="/api/files/${f.id}" alt="${escAttr(alt)}" data-lightbox="/api/files/${f.id}">`}
function bindLightbox(root=document){root.querySelectorAll('[data-lightbox],.gallery img').forEach(img=>img.onclick=()=>{const src=img.dataset.lightbox||img.src;const l=document.createElement('div');l.className='lightbox';l.innerHTML=`<img src="${src}">`;l.onclick=()=>l.remove();document.body.appendChild(l)})}
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');clearTimeout(window.__toastT);window.__toastT=setTimeout(()=>toastEl.classList.remove('show'),2600)}
function money(cents){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100)}
function num(n,d=2){return Number(n||0).toFixed(d).replace(/\.?0+$/,'')}
function dateFmt(s){if(!s)return'—';const d=new Date(s.endsWith?.('Z')||s.includes('T')?s:s.replace(' ','T')+'Z');return Number.isNaN(d)?s:new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(d)}
function dateOnly(s){if(!s)return'—';const [y,m,d]=String(s).slice(0,10).split('-').map(Number);return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(y,m-1,d))}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function escAttr(v){return esc(v).replace(/`/g,'&#096;')}
