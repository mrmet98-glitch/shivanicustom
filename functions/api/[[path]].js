const STATUS_STEPS = [
  'Project Received',
  'Designs Generated',
  'Designs In Review',
  'Project Approved',
  'In Production',
  'Shivani Gems QC',
  'Shipped',
  'Delivered',
];

const SESSION_COOKIE = 'sg_session';
const SESSION_DAYS = 14;

export async function onRequest(context) {
  try {
    if (!context.env.DB) {
      throw new Error('D1 binding DB is missing. Add a D1 binding named DB to this Pages environment, then redeploy.');
    }
    await ensureSchema(context.env.DB);
    await bootstrapUsers(context.env);
    return await route(context);
  } catch (err) {
    console.error('API error', err);
    return json({ error: 'Server error', detail: err?.message || String(err) }, 500);
  }
}

async function route(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = request.method.toUpperCase();
  const parts = path ? path.split('/').map(decodeURIComponent) : [];

  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  if (path === 'login' && method === 'POST') return login(request, env);
  if (path === 'logout' && method === 'POST') return logout(request, env);

  const auth = await requireAuth(request, env.DB);
  if (auth.response) return auth.response;
  const user = auth.user;

  if (path === 'me' && method === 'GET') return json({ user });
  if (path === 'meta' && method === 'GET') return json({ statuses: STATUS_STEPS });

  if (path === 'projects' && method === 'GET') return listProjects(env.DB, user);
  if (path === 'projects' && method === 'POST') return createProject(request, env, user);

  if (parts[0] === 'projects' && parts[1]) {
    const projectId = parts[1];
    if (parts.length === 2 && method === 'GET') return getProject(env.DB, user, projectId);
    if (parts.length === 2 && method === 'PATCH') return updateProject(request, env.DB, user, projectId);
    if (parts[2] === 'status' && method === 'PATCH') return updateProjectStatus(request, env.DB, user, projectId);
    if (parts[2] === 'designs' && method === 'POST') return createDesign(request, env, user, projectId);
  }

  if (parts[0] === 'designs' && parts[1]) {
    const designId = parts[1];
    if (parts.length === 2 && method === 'GET') return getDesign(env.DB, user, designId);
    if (parts[2] === 'comments' && method === 'POST') return addComment(request, env.DB, user, designId);
    if (parts[2] === 'approve' && method === 'POST') return approveDesign(env.DB, user, designId);
  }

  if (parts[0] === 'files' && parts[1] && method === 'GET') {
    return serveFile(env, user, parts[1]);
  }

  return json({ error: 'Not found' }, 404);
}

async function ensureSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','customer')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_type TEXT,
      client_reference TEXT,
      details TEXT,
      requested_delivery_date TEXT,
      metal TEXT,
      size_details TEXT,
      supplied_materials TEXT,
      internal_notes TEXT,
      status TEXT NOT NULL DEFAULT 'Project Received',
      approved_design_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS designs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      metal TEXT,
      price_cents INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS diamond_lines (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      shape TEXT,
      weight_ct REAL,
      weight_mode TEXT NOT NULL DEFAULT 'total' CHECK(weight_mode IN ('total','each')),
      stone_count INTEGER NOT NULL DEFAULT 1,
      color_clarity TEXT,
      measurements TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      design_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('reference','design')),
      object_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_designs_project ON designs(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_files_design ON files(design_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comments_design ON comments(design_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  ];
  await db.batch(statements.map((s) => db.prepare(s)));
}

async function bootstrapUsers(env) {
  const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  if ((count?.c || 0) > 0) return;
  if (!env.BOOTSTRAP_USERS_JSON) {
    throw new Error('BOOTSTRAP_USERS_JSON secret is missing. Add it in Cloudflare Pages > Settings > Variables and Secrets.');
  }
  const users = parseBootstrapUsers(env.BOOTSTRAP_USERS_JSON);
  if (!Array.isArray(users) || users.length === 0) throw new Error('BOOTSTRAP_USERS_JSON must be a non-empty array.');

  const inserts = [];
  for (const u of users) {
    if (!u.username || !u.passcode || !['admin', 'customer'].includes(u.role)) continue;
    const salt = randomHex(16);
    const hash = await hashPasscode(u.passcode, salt);
    inserts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO users (id, username, display_name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), u.username.trim(), (u.displayName || u.username).trim(), u.role, salt, hash));
  }
  if (!inserts.length) throw new Error('No valid bootstrap users were found.');
  await env.DB.batch(inserts);
}

function parseBootstrapUsers(value) {
  const original = String(value).trim();

  try {
    return JSON.parse(original);
  } catch {
    // Try the two common dashboard copy/paste mistakes below before reporting
    // a configuration error.
  }

  // Secret dashboards sometimes preserve pasted escape sequences instead of
  // turning them into whitespace. JSON permits whitespace between tokens, but
  // a literal "\\n" between tokens is invalid, so support that common paste.
  let normalized = original.replace(/\\[nrt]/g, (escape) => ({
    '\\n': '\n',
    '\\r': '\r',
    '\\t': '\t',
  })[escape]);

  // Also tolerate the variable name accidentally being pasted after the JSON.
  normalized = normalized.replace(/BOOTSTRAP_USERS_JSON\s*$/, '').trim();

  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new Error(
      `BOOTSTRAP_USERS_JSON is not valid JSON (${error.message}). ` +
      'Paste only the JSON array as the secret value; do not include the variable name.'
    );
  }
}

async function login(request, env) {
  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const passcode = String(body.passcode || '');
  if (!username || !passcode) return json({ error: 'Username and passcode are required.' }, 400);

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind(username).first();
  if (!user) return json({ error: 'Invalid username or passcode.' }, 401);

  const candidate = await hashPasscode(passcode, user.password_salt);
  if (!timingSafeEqual(candidate, user.password_hash)) return json({ error: 'Invalid username or passcode.' }, 401);

  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= datetime(\'now\')').run();
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expires).run();

  return json({ user: publicUser(user) }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

async function logout(request, env) {
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  });
}

async function requireAuth(request, db) {
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (!token) return { response: json({ error: 'Unauthorized' }, 401) };
  const row = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).bind(token).first();
  if (!row) return { response: json({ error: 'Session expired' }, 401) };
  return { user: publicUser(row) };
}

async function listProjects(db, user) {
  const rows = await db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM designs d WHERE d.project_id = p.id) AS design_count,
      (SELECT COALESCE(SUM(CASE WHEN dl.weight_mode='each' THEN COALESCE(dl.weight_ct,0)*COALESCE(dl.stone_count,1) ELSE COALESCE(dl.weight_ct,0) END),0)
       FROM diamond_lines dl JOIN designs d2 ON d2.id=dl.design_id WHERE d2.project_id=p.id) AS project_total_ctw
    FROM projects p ORDER BY datetime(p.updated_at) DESC, datetime(p.created_at) DESC
  `).all();
  return json({ projects: rows.results || [] });
}

async function createProject(request, env, user) {
  if (user.role !== 'admin') return forbidden();
  const form = await request.formData();
  const name = text(form, 'name');
  if (!name) return json({ error: 'Project name is required.' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const project = {
    id,
    name,
    project_type: text(form, 'project_type'),
    client_reference: text(form, 'client_reference'),
    details: text(form, 'details'),
    requested_delivery_date: text(form, 'requested_delivery_date'),
    metal: text(form, 'metal'),
    size_details: text(form, 'size_details'),
    supplied_materials: text(form, 'supplied_materials'),
    internal_notes: text(form, 'internal_notes'),
    status: 'Project Received',
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(`INSERT INTO projects
    (id,name,project_type,client_reference,details,requested_delivery_date,metal,size_details,supplied_materials,internal_notes,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, project.name, project.project_type, project.client_reference, project.details, project.requested_delivery_date,
    project.metal, project.size_details, project.supplied_materials, project.internal_notes, project.status, now, now).run();

  try {
    await saveUploads(env, form.getAll('reference_images'), { projectId: id, designId: null, kind: 'reference' });
  } catch (e) {
    await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run();
    throw e;
  }

  return json({ project: await projectSummary(env.DB, id) }, 201);
}

async function updateProject(request, db, user, projectId) {
  if (user.role !== 'admin') return forbidden();
  const exists = await db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
  if (!exists) return json({ error: 'Project not found.' }, 404);
  const body = await readJson(request);
  const allowed = ['name','project_type','client_reference','details','requested_delivery_date','metal','size_details','supplied_materials','internal_notes'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      sets.push(`${key}=?`);
      vals.push(body[key] == null ? '' : String(body[key]));
    }
  }
  if (!sets.length) return json({ ok: true });
  sets.push('updated_at=?');
  vals.push(new Date().toISOString(), projectId);
  await db.prepare(`UPDATE projects SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
  return json({ ok: true });
}

async function updateProjectStatus(request, db, user, projectId) {
  if (user.role !== 'admin') return forbidden();
  const body = await readJson(request);
  if (!STATUS_STEPS.includes(body.status)) return json({ error: 'Invalid status.' }, 400);
  const result = await db.prepare('UPDATE projects SET status=?, updated_at=? WHERE id=?')
    .bind(body.status, new Date().toISOString(), projectId).run();
  if (!result.meta?.changes) return json({ error: 'Project not found.' }, 404);
  return json({ ok: true, status: body.status });
}

async function createDesign(request, env, user, projectId) {
  if (user.role !== 'admin') return forbidden();
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
  if (!project) return json({ error: 'Project not found.' }, 404);

  const form = await request.formData();
  const title = text(form, 'title') || `Design ${Date.now()}`;
  const metal = text(form, 'metal');
  const description = text(form, 'description');
  const price = Number(form.get('price') || 0);
  if (!Number.isFinite(price) || price < 0) return json({ error: 'Price must be a valid positive amount.' }, 400);

  let diamonds = [];
  const diamondsRaw = text(form, 'diamonds');
  if (diamondsRaw) {
    try { diamonds = JSON.parse(diamondsRaw); } catch { return json({ error: 'Diamond info is invalid.' }, 400); }
  }
  if (!Array.isArray(diamonds)) return json({ error: 'Diamond info must be an array.' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO designs (id,project_id,title,description,metal,price_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id, projectId, title, description, metal, Math.round(price * 100), now, now).run();

  try {
    const diamondStatements = diamonds
      .filter(d => d && (d.shape || d.weight_ct || d.stone_count || d.color_clarity || d.measurements))
      .map((d, i) => env.DB.prepare(`INSERT INTO diamond_lines
        (id,design_id,shape,weight_ct,weight_mode,stone_count,color_clarity,measurements,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), id, String(d.shape || ''), numberOrNull(d.weight_ct), d.weight_mode === 'each' ? 'each' : 'total',
          Math.max(1, parseInt(d.stone_count || 1, 10)), String(d.color_clarity || ''), String(d.measurements || ''), i));
    if (diamondStatements.length) await env.DB.batch(diamondStatements);
    await saveUploads(env, form.getAll('design_images'), { projectId, designId: id, kind: 'design' });
    await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now,projectId).run();
  } catch (e) {
    await env.DB.prepare('DELETE FROM designs WHERE id=?').bind(id).run();
    throw e;
  }

  return json({ design: await designDetail(env.DB, id) }, 201);
}

async function getProject(db, user, projectId) {
  const project = await db.prepare('SELECT * FROM projects WHERE id=?').bind(projectId).first();
  if (!project) return json({ error: 'Project not found.' }, 404);
  if (user.role !== 'admin') delete project.internal_notes;

  const refs = await db.prepare(`SELECT id,filename,content_type,size_bytes FROM files WHERE project_id=? AND kind='reference' ORDER BY created_at`).bind(projectId).all();
  const designs = await db.prepare(`
    SELECT d.*,
      (SELECT id FROM files f WHERE f.design_id=d.id ORDER BY f.created_at LIMIT 1) AS thumbnail_file_id,
      (SELECT COALESCE(SUM(CASE WHEN dl.weight_mode='each' THEN COALESCE(dl.weight_ct,0)*COALESCE(dl.stone_count,1) ELSE COALESCE(dl.weight_ct,0) END),0) FROM diamond_lines dl WHERE dl.design_id=d.id) AS total_ctw,
      (SELECT COUNT(*) FROM comments c WHERE c.design_id=d.id) AS comment_count
    FROM designs d WHERE d.project_id=?
    ORDER BY d.approved DESC, datetime(d.created_at) DESC
  `).bind(projectId).all();

  return json({ project, reference_files: refs.results || [], designs: designs.results || [], statuses: STATUS_STEPS });
}

async function getDesign(db, user, designId) {
  const design = await designDetail(db, designId);
  if (!design) return json({ error: 'Design not found.' }, 404);
  return json({ design });
}

async function designDetail(db, designId) {
  const design = await db.prepare(`SELECT d.*, p.name AS project_name, p.status AS project_status, p.approved_design_id FROM designs d JOIN projects p ON p.id=d.project_id WHERE d.id=?`).bind(designId).first();
  if (!design) return null;
  const [diamonds, files, comments] = await Promise.all([
    db.prepare('SELECT * FROM diamond_lines WHERE design_id=? ORDER BY sort_order,id').bind(designId).all(),
    db.prepare(`SELECT id,filename,content_type,size_bytes FROM files WHERE design_id=? AND kind='design' ORDER BY created_at`).bind(designId).all(),
    db.prepare(`SELECT c.id,c.body,c.created_at,u.display_name,u.role FROM comments c JOIN users u ON u.id=c.user_id WHERE c.design_id=? ORDER BY datetime(c.created_at), c.id`).bind(designId).all(),
  ]);
  design.diamonds = diamonds.results || [];
  design.files = files.results || [];
  design.comments = comments.results || [];
  design.total_ctw = design.diamonds.reduce((sum, d) => sum + (Number(d.weight_ct) || 0) * (d.weight_mode === 'each' ? (Number(d.stone_count) || 1) : 1), 0);
  return design;
}

async function addComment(request, db, user, designId) {
  const exists = await db.prepare('SELECT id FROM designs WHERE id=?').bind(designId).first();
  if (!exists) return json({ error: 'Design not found.' }, 404);
  const body = await readJson(request);
  const comment = String(body.body || '').trim();
  if (!comment) return json({ error: 'Comment cannot be empty.' }, 400);
  if (comment.length > 5000) return json({ error: 'Comment is too long.' }, 400);
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO comments (id,design_id,user_id,body) VALUES (?,?,?,?)').bind(id,designId,user.id,comment).run();
  const row = await db.prepare(`SELECT c.id,c.body,c.created_at,u.display_name,u.role FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`).bind(id).first();
  return json({ comment: row }, 201);
}

async function approveDesign(db, user, designId) {
  if (user.role !== 'customer') return json({ error: 'Only the customer can approve a design.' }, 403);
  const d = await db.prepare('SELECT id, project_id FROM designs WHERE id=?').bind(designId).first();
  if (!d) return json({ error: 'Design not found.' }, 404);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE designs SET approved=0, updated_at=? WHERE project_id=?').bind(now,d.project_id),
    db.prepare('UPDATE designs SET approved=1, updated_at=? WHERE id=?').bind(now,designId),
    db.prepare('UPDATE projects SET approved_design_id=?, status=?, updated_at=? WHERE id=?').bind(designId,'Project Approved',now,d.project_id),
  ]);
  return json({ ok: true, project_id: d.project_id, status: 'Project Approved' });
}

async function serveFile(env, user, fileId) {
  const meta = await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(fileId).first();
  if (!meta) return new Response('Not found', { status: 404 });
  const obj = await env.UPLOADS.get(meta.object_key);
  if (!obj) return new Response('Not found', { status: 404 });

  const contentType = meta.content_type || 'application/octet-stream';
  const isRenderableImage = /^image\/(png|jpe?g|webp|gif|avif|bmp)$/i.test(contentType);
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!isRenderableImage) headers.set('Content-Disposition', `attachment; filename="${safeFilename(meta.filename)}"`);
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

async function saveUploads(env, files, { projectId, designId, kind }) {
  const valid = files.filter(f => f && typeof f.arrayBuffer === 'function' && f.size > 0);
  for (const file of valid) {
    const id = crypto.randomUUID();
    const objectKey = `${projectId}/${kind}/${designId || 'project'}/${id}-${sanitizeKey(file.name || 'upload')}`;
    await env.UPLOADS.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { originalName: file.name || 'upload' },
    });
    try {
      await env.DB.prepare(`INSERT INTO files (id,project_id,design_id,kind,object_key,filename,content_type,size_bytes) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(id,projectId,designId,kind,objectKey,file.name || 'upload',file.type || 'application/octet-stream',file.size || 0).run();
    } catch (e) {
      await env.UPLOADS.delete(objectKey);
      throw e;
    }
  }
}

async function projectSummary(db, id) {
  return db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM designs d WHERE d.project_id=p.id) AS design_count FROM projects p WHERE p.id=?`).bind(id).first();
}

function publicUser(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
}

function forbidden() { return json({ error: 'Admin access required.' }, 403); }
function text(form, key) { return String(form.get(key) || '').trim(); }
function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function safeFilename(s) { return String(s || 'file').replace(/["\r\n]/g, '_'); }
function sanitizeKey(s) { return String(s).replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120); }
function parseCookies(header) {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('='); return i < 0 ? [v,''] : [v.slice(0,i), decodeURIComponent(v.slice(i+1))];
  }));
}
async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
function json(data, status=200, extraHeaders={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extraHeaders },
  });
}
function randomHex(bytes) {
  const arr = new Uint8Array(bytes); crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2,'0')).join('');
}
async function hashPasscode(passcode, salt) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:enc.encode(salt), iterations:160000 }, material, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('');
}
function timingSafeEqual(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0; for (let i=0;i<a.length;i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0;
}
