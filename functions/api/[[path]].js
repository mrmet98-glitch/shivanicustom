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
const DEFAULT_CUSTOMER_EMAIL = 'doug@uniqjewelry.com';
const DEFAULT_INTERNAL_EMAILS = ['saunak@shivanigems.com', 'atit@shivanigems.com'];
const DEFAULT_FROM_EMAIL = 'Shivani Gems Custom Projects <saunak@shivanigems.com>';
const DEFAULT_REPLY_TO_EMAIL = 'saunak@shivanigems.com';
const DEFAULT_PORTAL_URL = 'https://shivanicustom.pages.dev';
const RESEND_TEMPLATE_IDS = {
  design_created: 'f6ce7f37-e54f-4376-bd7b-b8c860864f1f',
  comment_customer: '7aaaab43-c893-4742-b6a4-9a889e5d3e63',
  comment_internal: 'ab32d087-e2f2-4709-9230-803cf5ca790d',
  design_approved: '4521d9b8-8b02-4663-bd0f-07fa50f3a322',
  status_updated: '497ab82a-d7e4-4309-a6af-c082c5a54273',
};

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
    if (parts.length === 2 && method === 'PATCH') return updateProject(request, env, user, projectId);
    if (parts.length === 2 && method === 'DELETE') return deleteProject(env, user, projectId);
    if (parts[2] === 'status' && method === 'PATCH') return updateProjectStatus(request, env, user, projectId);
    if (parts[2] === 'designs' && method === 'POST') return createDesign(request, env, user, projectId);
  }

  if (parts[0] === 'designs' && parts[1]) {
    const designId = parts[1];
    if (parts.length === 2 && method === 'GET') return getDesign(env.DB, user, designId);
    if (parts.length === 2 && method === 'PATCH') return updateDesign(request, env, user, designId);
    if (parts[2] === 'comments' && method === 'POST') return addComment(request, env, user, designId);
    if (parts[2] === 'approve' && method === 'POST') return approveDesign(env, user, designId);
    if (parts[2] === 'review' && method === 'PATCH') return reviewDesign(request, env, user, designId);
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
      has_price INTEGER NOT NULL DEFAULT 1,
      price_includes_diamonds INTEGER NOT NULL DEFAULT 0,
      price_includes_findings INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'pending',
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
      diamond_origin TEXT NOT NULL DEFAULT '',
      provided_by TEXT NOT NULL DEFAULT '',
      measurements TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS finding_lines (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      description TEXT,
      finding_type TEXT NOT NULL DEFAULT 'Other',
      metal TEXT,
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
    `CREATE TABLE IF NOT EXISTS project_activity (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      design_id TEXT,
      actor_user_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE,
      FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS project_activity_reads (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(project_id,user_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_designs_project ON designs(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_files_design ON files(design_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comments_design ON comments(design_id)`,
    `CREATE INDEX IF NOT EXISTS idx_findings_design ON finding_lines(design_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_project ON project_activity(project_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  ];
  await db.batch(statements.map((s) => db.prepare(s)));
  await ensureColumn(db, 'designs', 'has_price', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'designs', 'price_includes_diamonds', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'designs', 'price_includes_findings', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'designs', 'review_status', "TEXT NOT NULL DEFAULT 'pending'");
  await ensureColumn(db, 'diamond_lines', 'diamond_origin', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'diamond_lines', 'provided_by', "TEXT NOT NULL DEFAULT ''");
}

async function ensureColumn(db, table, column, definition) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all();
  if (!(info.results || []).some((entry) => entry.name === column)) {
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    } catch (error) {
      // Concurrent first requests may both observe the old schema. Only ignore
      // the race when another request successfully added this exact column.
      const refreshed = await db.prepare(`PRAGMA table_info(${table})`).all();
      if (!(refreshed.results || []).some((entry) => entry.name === column)) throw error;
    }
  }
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
      (SELECT COUNT(*) FROM project_activity a WHERE a.project_id=p.id AND a.actor_user_id<>? AND a.activity_type='comment'
        AND datetime(a.created_at)>datetime(COALESCE((SELECT r.last_seen_at FROM project_activity_reads r WHERE r.project_id=p.id AND r.user_id=?),'1970-01-01'))) AS unseen_comment_count,
      (SELECT COUNT(*) FROM project_activity a WHERE a.project_id=p.id AND a.actor_user_id<>? AND a.activity_type='design_created'
        AND datetime(a.created_at)>datetime(COALESCE((SELECT r.last_seen_at FROM project_activity_reads r WHERE r.project_id=p.id AND r.user_id=?),'1970-01-01'))) AS unseen_design_count,
      (SELECT COUNT(*) FROM project_activity a WHERE a.project_id=p.id AND a.actor_user_id<>? AND a.activity_type IN ('design_updated','design_reviewed','design_rejected','design_approved','project_updated')
        AND datetime(a.created_at)>datetime(COALESCE((SELECT r.last_seen_at FROM project_activity_reads r WHERE r.project_id=p.id AND r.user_id=?),'1970-01-01'))) AS unseen_update_count,
      (SELECT COALESCE(SUM(CASE WHEN dl.weight_mode='each' THEN COALESCE(dl.weight_ct,0)*COALESCE(dl.stone_count,1) ELSE COALESCE(dl.weight_ct,0) END),0)
       FROM diamond_lines dl JOIN designs d2 ON d2.id=dl.design_id WHERE d2.project_id=p.id) AS project_total_ctw
    FROM projects p ORDER BY datetime(p.updated_at) DESC, datetime(p.created_at) DESC
  `).bind(user.id,user.id,user.id,user.id,user.id,user.id).all();
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
  await recordActivity(env.DB, { projectId:id, actorUserId:user.id, type:'project_updated' });

  try {
    await saveUploads(env, form.getAll('reference_images'), { projectId: id, designId: null, kind: 'reference' });
  } catch (e) {
    await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run();
    throw e;
  }

  return json({ project: await projectSummary(env.DB, id) }, 201);
}

async function updateProject(request, env, user, projectId) {
  if (user.role !== 'admin') return forbidden();
  const db = env.DB;
  const exists = await db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
  if (!exists) return json({ error: 'Project not found.' }, 404);
  const isMultipart = (request.headers.get('content-type') || '').includes('multipart/form-data');
  const form = isMultipart ? await request.formData() : null;
  const body = form ? Object.fromEntries(form) : await readJson(request);
  const allowed = ['name','project_type','client_reference','details','requested_delivery_date','metal','size_details','supplied_materials','internal_notes'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      sets.push(`${key}=?`);
      vals.push(body[key] == null ? '' : String(body[key]).trim());
    }
  }
  const removeIds = parseJsonOr(form?.get('remove_reference_ids') || '[]', null);
  if (!Array.isArray(removeIds)) return json({ error: 'Invalid reference image selection.' }, 400);
  const uniqueRemoveIds = [...new Set(removeIds.map(String))];
  const removable = [];
  for (const fileId of uniqueRemoveIds) {
    const file = await db.prepare("SELECT id,object_key FROM files WHERE id=? AND project_id=? AND kind='reference'").bind(fileId, projectId).first();
    if (file) removable.push(file);
  }
  if (form) await saveUploads(env, form.getAll('reference_images'), { projectId, designId:null, kind:'reference' });
  if (sets.length) {
    sets.push('updated_at=?');
    vals.push(new Date().toISOString(), projectId);
    await db.prepare(`UPDATE projects SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
  }
  for (const file of removable) await db.prepare('DELETE FROM files WHERE id=?').bind(file.id).run();
  if (removable.length) {
    try { await env.UPLOADS.delete(removable.map(file => file.object_key)); }
    catch (error) { console.error('Reference image cleanup error', error); }
  }
  await recordActivity(db, { projectId, actorUserId:user.id, type:'project_updated' });
  return json({ ok: true });
}

async function deleteProject(env, user, projectId) {
  if (user.role !== 'admin') return forbidden();
  const project = await env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first();
  if (!project) return json({ error: 'Project not found.' }, 404);

  const files = await env.DB.prepare('SELECT object_key FROM files WHERE project_id=?').bind(projectId).all();
  await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();

  let storageWarning = null;
  try {
    const keys = (files.results || []).map((file) => file.object_key);
    if (keys.length) await env.UPLOADS.delete(keys);
  } catch (error) {
    // The project is already deleted; report orphan cleanup failure without
    // incorrectly telling the administrator that the deletion itself failed.
    console.error('Project upload cleanup error', error);
    storageWarning = error?.message || String(error);
  }

  return json({ ok: true, project: { id: project.id, name: project.name }, storage_warning: storageWarning });
}

async function updateProjectStatus(request, env, user, projectId) {
  if (user.role !== 'admin') return forbidden();
  const body = await readJson(request);
  if (!STATUS_STEPS.includes(body.status)) return json({ error: 'Invalid status.' }, 400);
  const project = await env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first();
  if (!project) return json({ error: 'Project not found.' }, 404);
  const result = await env.DB.prepare('UPDATE projects SET status=?, updated_at=? WHERE id=?')
    .bind(body.status, new Date().toISOString(), projectId).run();
  if (!result.meta?.changes) return json({ error: 'Project not found.' }, 404);
  await recordActivity(env.DB, { projectId, actorUserId:user.id, type:'project_updated' });
  const notificationWarning = await notifyResend(env, {
    eventType: 'status_updated', projectId, projectName: project.name,
    actorName: user.display_name, actorRole: user.role, projectStatus: body.status,
  });
  return json({ ok: true, status: body.status, notification_warning: notificationWarning });
}

async function createDesign(request, env, user, projectId) {
  if (user.role !== 'admin') return forbidden();
  const project = await env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first();
  if (!project) return json({ error: 'Project not found.' }, 404);

  const form = await request.formData();
  const title = text(form, 'title') || `Design ${Date.now()}`;
  const metal = text(form, 'metal');
  const description = text(form, 'description');
  const priceRaw = text(form, 'price');
  const hasPrice = priceRaw !== '';
  const price = hasPrice ? Number(priceRaw) : 0;
  if (!Number.isFinite(price) || price < 0) return json({ error: 'Price must be a valid positive amount.' }, 400);
  const priceIncludesDiamonds = hasPrice && form.get('price_includes_diamonds') === 'on';
  const priceIncludesFindings = hasPrice && form.get('price_includes_findings') === 'on';

  let diamonds = [];
  const diamondsRaw = text(form, 'diamonds');
  if (diamondsRaw) {
    try { diamonds = JSON.parse(diamondsRaw); } catch { return json({ error: 'Diamond info is invalid.' }, 400); }
  }
  if (!Array.isArray(diamonds)) return json({ error: 'Diamond info must be an array.' }, 400);
  let findings = [];
  try { findings = JSON.parse(text(form, 'findings') || '[]'); } catch { return json({ error: 'Findings info is invalid.' }, 400); }
  if (!Array.isArray(findings)) return json({ error: 'Findings info must be an array.' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO designs (id,project_id,title,description,metal,price_cents,has_price,price_includes_diamonds,price_includes_findings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, projectId, title, description, metal, Math.round(price * 100), hasPrice ? 1 : 0, priceIncludesDiamonds ? 1 : 0, priceIncludesFindings ? 1 : 0, now, now).run();

  try {
    const diamondStatements = diamonds
      .filter(d => d && (d.shape || d.weight_ct || d.stone_count || d.color_clarity || d.measurements || d.provided_by))
      .map((d, i) => env.DB.prepare(`INSERT INTO diamond_lines
        (id,design_id,shape,weight_ct,weight_mode,stone_count,color_clarity,diamond_origin,provided_by,measurements,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), id, String(d.shape || ''), numberOrNull(d.weight_ct), d.weight_mode === 'each' ? 'each' : 'total',
          Math.max(1, parseInt(d.stone_count || 1, 10)), String(d.color_clarity || ''),
          ['Natural', 'Lab Grown'].includes(d.diamond_origin) ? d.diamond_origin : '', normalizeProvidedBy(d.provided_by), String(d.measurements || ''), i));
    if (diamondStatements.length) await env.DB.batch(diamondStatements);
    await replaceFindings(env.DB, id, findings, false);
    await saveUploads(env, form.getAll('design_images'), { projectId, designId: id, kind: 'design' });
    await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now,projectId).run();
    await recordActivity(env.DB, { projectId, designId:id, actorUserId:user.id, type:'design_created' });
  } catch (e) {
    await env.DB.prepare('DELETE FROM designs WHERE id=?').bind(id).run();
    throw e;
  }

  const notificationWarning = await notifyResend(env, {
    eventType: 'design_created', projectId, projectName: project.name,
    designId: id, designTitle: title, actorName: user.display_name, actorRole: user.role,
  });

  return json({ design: await designDetail(env.DB, id), notification_warning: notificationWarning }, 201);
}

async function updateDesign(request, env, user, designId) {
  if (user.role !== 'admin') return forbidden();
  const existing = await env.DB.prepare('SELECT id,project_id FROM designs WHERE id=?').bind(designId).first();
  if (!existing) return json({ error: 'Design not found.' }, 404);
  const form = await request.formData();
  const title = text(form, 'title');
  if (!title) return json({ error: 'Proposal name is required.' }, 400);
  const priceRaw = text(form, 'price'), hasPrice = priceRaw !== '', price = hasPrice ? Number(priceRaw) : 0;
  if (!Number.isFinite(price) || price < 0) return json({ error: 'Price must be a valid positive amount.' }, 400);
  let diamonds, findings;
  try { diamonds = JSON.parse(text(form, 'diamonds') || '[]'); findings = JSON.parse(text(form, 'findings') || '[]'); }
  catch { return json({ error: 'Proposal line information is invalid.' }, 400); }
  if (!Array.isArray(diamonds) || !Array.isArray(findings)) return json({ error: 'Proposal lines must be arrays.' }, 400);
  const removeImageIds = parseJsonOr(text(form, 'remove_design_image_ids') || '[]', null);
  if (!Array.isArray(removeImageIds)) return json({ error: 'Invalid proposal image selection.' }, 400);
  const removableImages = [];
  for (const fileId of [...new Set(removeImageIds.map(String))]) {
    const file = await env.DB.prepare("SELECT id,object_key FROM files WHERE id=? AND design_id=? AND kind='design'").bind(fileId, designId).first();
    if (file) removableImages.push(file);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE designs SET title=?,description=?,metal=?,price_cents=?,has_price=?,price_includes_diamonds=?,price_includes_findings=?,review_status=CASE WHEN review_status='reviewed' THEN 'pending' ELSE review_status END,updated_at=? WHERE id=?`)
    .bind(title, text(form, 'description'), text(form, 'metal'), Math.round(price * 100), hasPrice ? 1 : 0,
      hasPrice && form.get('price_includes_diamonds') === 'on' ? 1 : 0, hasPrice && form.get('price_includes_findings') === 'on' ? 1 : 0, now, designId).run();
  await env.DB.prepare('DELETE FROM diamond_lines WHERE design_id=?').bind(designId).run();
  const diamondStatements = diamonds.filter(d => d && (d.shape || d.weight_ct || d.color_clarity || d.measurements || d.provided_by)).map((d, i) => env.DB.prepare(`INSERT INTO diamond_lines
    (id,design_id,shape,weight_ct,weight_mode,stone_count,color_clarity,diamond_origin,provided_by,measurements,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), designId, String(d.shape || ''), numberOrNull(d.weight_ct), d.weight_mode === 'each' ? 'each' : 'total', Math.max(1, parseInt(d.stone_count || 1, 10)), String(d.color_clarity || ''), ['Natural','Lab Grown'].includes(d.diamond_origin) ? d.diamond_origin : '', normalizeProvidedBy(d.provided_by), String(d.measurements || ''), i));
  if (diamondStatements.length) await env.DB.batch(diamondStatements);
  await replaceFindings(env.DB, designId, findings, true);
  await saveUploads(env, form.getAll('design_images'), { projectId: existing.project_id, designId, kind: 'design' });
  for (const file of removableImages) await env.DB.prepare('DELETE FROM files WHERE id=?').bind(file.id).run();
  if (removableImages.length) {
    try { await env.UPLOADS.delete(removableImages.map(file => file.object_key)); }
    catch (error) { console.error('Proposal image cleanup error', error); }
  }
  await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now, existing.project_id).run();
  await recordActivity(env.DB, { projectId:existing.project_id, designId, actorUserId:user.id, type:'design_updated' });
  return json({ design: await designDetail(env.DB, designId) });
}

async function replaceFindings(db, designId, findings, removeExisting) {
  if (removeExisting) await db.prepare('DELETE FROM finding_lines WHERE design_id=?').bind(designId).run();
  const statements = findings.filter(f => f && (f.description || f.metal)).map((f, i) => db.prepare(`INSERT INTO finding_lines
    (id,design_id,description,finding_type,metal,sort_order) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), designId,
      String(f.description || ''), ['Chain','Earring Backs','Other'].includes(f.finding_type) ? f.finding_type : 'Other', String(f.metal || ''), i));
  if (statements.length) await db.batch(statements);
}

async function getProject(db, user, projectId) {
  const seenAt = new Date().toISOString();
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

  await db.prepare(`INSERT INTO project_activity_reads (project_id,user_id,last_seen_at) VALUES (?,?,?)
    ON CONFLICT(project_id,user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`).bind(projectId,user.id,seenAt).run();
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
  const [diamonds, findings, files, comments] = await Promise.all([
    db.prepare('SELECT * FROM diamond_lines WHERE design_id=? ORDER BY sort_order,id').bind(designId).all(),
    db.prepare('SELECT * FROM finding_lines WHERE design_id=? ORDER BY sort_order,id').bind(designId).all(),
    db.prepare(`SELECT id,filename,content_type,size_bytes FROM files WHERE design_id=? AND kind='design' ORDER BY created_at`).bind(designId).all(),
    db.prepare(`SELECT c.id,c.body,c.created_at,u.display_name,u.role FROM comments c JOIN users u ON u.id=c.user_id WHERE c.design_id=? ORDER BY datetime(c.created_at), c.id`).bind(designId).all(),
  ]);
  design.diamonds = diamonds.results || [];
  design.findings = findings.results || [];
  design.files = files.results || [];
  design.comments = comments.results || [];
  design.total_ctw = design.diamonds.reduce((sum, d) => sum + (Number(d.weight_ct) || 0) * (d.weight_mode === 'each' ? (Number(d.stone_count) || 1) : 1), 0);
  return design;
}

async function addComment(request, env, user, designId) {
  const exists = await env.DB.prepare(`SELECT d.id,d.title,d.project_id,p.name AS project_name
    FROM designs d JOIN projects p ON p.id=d.project_id WHERE d.id=?`).bind(designId).first();
  if (!exists) return json({ error: 'Design not found.' }, 404);
  const body = await readJson(request);
  const comment = String(body.body || '').trim();
  if (!comment) return json({ error: 'Comment cannot be empty.' }, 400);
  if (comment.length > 5000) return json({ error: 'Comment is too long.' }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO comments (id,design_id,user_id,body) VALUES (?,?,?,?)').bind(id,designId,user.id,comment).run();
  await env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(new Date().toISOString(),exists.project_id).run();
  await recordActivity(env.DB, { projectId:exists.project_id, designId, actorUserId:user.id, type:'comment' });
  const row = await env.DB.prepare(`SELECT c.id,c.body,c.created_at,u.display_name,u.role FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`).bind(id).first();
  const notificationWarning = await notifyResend(env, {
    eventType: 'comment_created', projectId: exists.project_id, projectName: exists.project_name,
    designId, designTitle: exists.title, actorName: user.display_name, actorRole: user.role, message: comment,
  });
  return json({ comment: row, notification_warning: notificationWarning }, 201);
}

async function approveDesign(env, user, designId) {
  if (user.role !== 'customer') return json({ error: 'Only the customer can approve a design.' }, 403);
  const d = await env.DB.prepare(`SELECT d.id,d.title,d.project_id,p.name AS project_name
    FROM designs d JOIN projects p ON p.id=d.project_id WHERE d.id=?`).bind(designId).first();
  if (!d) return json({ error: 'Design not found.' }, 404);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE designs SET approved=0, updated_at=? WHERE project_id=?').bind(now,d.project_id),
    env.DB.prepare("UPDATE designs SET approved=1, review_status='reviewed', updated_at=? WHERE id=?").bind(now,designId),
    env.DB.prepare('UPDATE projects SET approved_design_id=?, status=?, updated_at=? WHERE id=?').bind(designId,'Project Approved',now,d.project_id),
  ]);
  await recordActivity(env.DB, { projectId:d.project_id, designId, actorUserId:user.id, type:'design_approved' });
  const notificationWarning = await notifyResend(env, {
    eventType: 'design_approved', projectId: d.project_id, projectName: d.project_name,
    designId, designTitle: d.title, actorName: user.display_name, actorRole: user.role,
    projectStatus: 'Project Approved',
  });
  return json({ ok: true, project_id: d.project_id, status: 'Project Approved', notification_warning: notificationWarning });
}

async function reviewDesign(request, env, user, designId) {
  if (user.role !== 'customer') return json({ error: 'Only the customer can review a design.' }, 403);
  const body = await readJson(request);
  if (!['reviewed','rejected'].includes(body.status)) return json({ error: 'Review status must be reviewed or rejected.' }, 400);
  const design = await env.DB.prepare('SELECT id,project_id,approved FROM designs WHERE id=?').bind(designId).first();
  if (!design) return json({ error: 'Design not found.' }, 404);
  if (body.status === 'rejected' && Number(design.approved) === 1) return json({ error: 'An approved design cannot be rejected.' }, 409);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE designs SET review_status=?,updated_at=? WHERE id=?').bind(body.status,now,designId),
    env.DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(now,design.project_id),
  ]);
  await recordActivity(env.DB, { projectId:design.project_id, designId, actorUserId:user.id, type:body.status === 'rejected' ? 'design_rejected' : 'design_reviewed' });
  return json({ ok:true, project_id:design.project_id, review_status:body.status });
}

async function recordActivity(db, { projectId, designId=null, actorUserId, type }) {
  await db.prepare(`INSERT INTO project_activity (id,project_id,design_id,actor_user_id,activity_type,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),projectId,designId,actorUserId,type,new Date().toISOString()).run();
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

async function notifyResend(env, event) {
  const customerEmail = env.CUSTOMER_NOTIFICATION_EMAIL || DEFAULT_CUSTOMER_EMAIL;
  const internalEmails = String(env.INTERNAL_NOTIFICATION_EMAILS || DEFAULT_INTERNAL_EMAILS.join(','))
    .split(',').map(email => email.trim()).filter(Boolean);
  const from = env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  const replyTo = env.RESEND_REPLY_TO || DEFAULT_REPLY_TO_EMAIL;
  const siteUrl = String(env.PORTAL_URL || DEFAULT_PORTAL_URL).replace(/\/$/, '');
  const projectUrl = `${siteUrl}/#/project/${encodeURIComponent(event.projectId)}`;
  const notification = resendNotification(event, projectUrl, customerEmail, internalEmails, env);

  try {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is missing from the Cloudflare environment.');
    if (!notification.to.length) throw new Error('No recipient email is configured for this notification.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: notification.to,
        reply_to: replyTo,
        template: {
          id: notification.templateId,
          variables: notification.variables,
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Resend email failed (${response.status}): ${detail.slice(0, 500)}`);
    }
    return null;
  } catch (error) {
    // Notifications must never roll back a successful portal action. Cloudflare
    // logs retain the failure so the Resend configuration can be corrected.
    console.error('Resend notification error', error);
    return error?.message || String(error);
  }
}

function resendNotification(event, projectUrl, customerEmail, internalEmails, env) {
  const common = { PROJECT_NAME: event.projectName, PROJECT_URL: projectUrl };
  if (event.eventType === 'design_created') {
    return {
      to: [customerEmail],
      templateId: env.RESEND_TEMPLATE_NEW_DESIGN_CUSTOMER || RESEND_TEMPLATE_IDS.design_created,
      variables: { ...common, DESIGN_TITLE: event.designTitle },
    };
  }
  if (event.eventType === 'comment_created') {
    const isCustomerComment = event.actorRole === 'customer';
    return {
      to: isCustomerComment ? internalEmails : [customerEmail],
      templateId: isCustomerComment
        ? env.RESEND_TEMPLATE_COMMENT_INTERNAL || RESEND_TEMPLATE_IDS.comment_internal
        : env.RESEND_TEMPLATE_COMMENT_CUSTOMER || RESEND_TEMPLATE_IDS.comment_customer,
      variables: { ...common, ACTOR_NAME: event.actorName, COMMENT_MESSAGE: event.message },
    };
  }
  if (event.eventType === 'design_approved') {
    return {
      to: internalEmails,
      templateId: env.RESEND_TEMPLATE_DESIGN_APPROVED || RESEND_TEMPLATE_IDS.design_approved,
      variables: { ...common, DESIGN_TITLE: event.designTitle },
    };
  }
  if (event.eventType === 'status_updated') {
    return {
      to: [customerEmail],
      templateId: env.RESEND_TEMPLATE_STATUS_UPDATED || RESEND_TEMPLATE_IDS.status_updated,
      variables: { ...common, PROJECT_STATUS: event.projectStatus },
    };
  }
  throw new Error(`Unsupported notification event: ${event.eventType}`);
}

async function projectSummary(db, id) {
  return db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM designs d WHERE d.project_id=p.id) AS design_count FROM projects p WHERE p.id=?`).bind(id).first();
}

function publicUser(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
}

function forbidden() { return json({ error: 'Admin access required.' }, 403); }
function text(form, key) { return String(form.get(key) || '').trim(); }
function parseJsonOr(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function normalizeProvidedBy(value) { return ['Customer Provided','Shivani Provided'].includes(value) ? value : ''; }
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
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:enc.encode(salt), iterations:100000 }, material, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('');
}
function timingSafeEqual(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0; for (let i=0;i<a.length;i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0;
}
