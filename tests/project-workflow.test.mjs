import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/api/[[path]].js';

function database(sqlite) {
  return {
    prepare(sql) {
      let values=[];
      return {
        bind(...args){values=args;return this},
        async first(){return sqlite.prepare(sql).get(...values)||null},
        async all(){return {results:sqlite.prepare(sql).all(...values)}},
        async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}}},
      };
    },
    async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}},
  };
}

test('migration, customer submissions, acceptance, archive, privacy and Resend contracts', async()=>{
  const sqlite=new DatabaseSync(':memory:');
  // Exercise upgrades from the pre-feature schema, including a retained project.
  const schema=(await readFile(new URL('../schema.sql',import.meta.url),'utf8')).replace(/  (archived|acceptance_status|submitted_by).*\n/g,'');
  sqlite.exec(schema);
  sqlite.exec("INSERT INTO projects(id,name,internal_notes) VALUES('legacy','Existing project','Private legacy note')");
  const objects=new Map();
  const env={DB:database(sqlite),UPLOADS:{async put(key,stream){objects.set(key,await new Response(stream).arrayBuffer())},async get(key){return objects.has(key)?{body:objects.get(key)}:null},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key)}} ,BOOTSTRAP_USERS_JSON:JSON.stringify([
    {username:'Saunak',displayName:'Saunak',role:'admin',passcode:'test-admin'},
    {username:'Atit',displayName:'Atit',role:'admin',passcode:'test-atit'},
    {username:'Doug',displayName:'Doug',role:'customer',passcode:'test-customer'},
    {username:'Other',displayName:'Other',role:'customer',passcode:'test-other'},
  ]),RESEND_API_KEY:'test-only',PORTAL_URL:'https://portal.example'};
  const messages=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://api.resend.com/emails');messages.push(JSON.parse(opts.body));return new Response('{}',{status:200})};
  const request=(path,method='GET',cookie='',body)=>onRequest({env,request:new Request('https://portal.example/api/'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined})});
  async function login(username,passcode){const r=await request('login','POST','',{username,passcode});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
  async function expect(path,method,cookie,body,status){const r=await request(path,method,cookie,body);assert.equal(r.status,status,await r.clone().text());return r.json()}
  function form(name){const f=new FormData();for(const [key,value]of Object.entries({name,project_type:'Pendant',client_reference:'PO-123',details:'Full brief',requested_delivery_date:'2026-11-15',metal:'14K',size_details:'18mm',supplied_materials:'Customer stone',internal_notes:'Customer must not set this'}))f.set(key,value);f.append('reference_images',new Blob(['test-image'],{type:'image/png'}),'reference.png');return f}
  try{
    const admin=await login('Saunak','test-admin'),atit=await login('Atit','test-atit'),doug=await login('Doug','test-customer'),other=await login('Other','test-other');
    const legacy=(await expect('projects','GET',doug,null,200)).projects[0];assert.equal(legacy.acceptance_status,'accepted');assert.equal(legacy.archived,0);assert.equal('internal_notes'in legacy,false);
    const submitted=await expect('projects','POST',doug,form('Doug project'),201),id=submitted.project.id;
    assert.equal(submitted.project.acceptance_status,'pending');assert.equal('internal_notes'in submitted.project,false);
    assert.equal(messages.length,1);assert.deepEqual(messages[0].to,['saunak@shivanigems.com','atit@shivanigems.com']);assert.equal(messages[0].template.id,'412ae95b-2cc5-49c9-acaf-3a1189854582');assert.deepEqual(messages[0].template.variables,{PROJECT_NAME:'Doug project',PROJECT_URL:`https://portal.example/#/project/${id}`,CUSTOMER_NAME:'Doug',REQUESTED_DELIVERY_DATE:'November 15, 2026'});
    assert.equal((await expect(`projects/${id}`,'GET',admin,null,200)).project.internal_notes,'');
    await expect(`projects/${id}`,'GET',other,null,404);assert.ok(!(await expect('projects','GET',other,null,200)).projects.some(p=>p.id===id));
    const detail=await expect(`projects/${id}`,'GET',doug,null,200),file=detail.reference_files[0].id;
    assert.equal(await (await request(`files/${file}`,'GET',doug)).text(),'test-image');assert.equal((await request(`files/${file}`,'GET',other)).status,404);
    const imageEdit=new FormData();imageEdit.set('remove_reference_ids',JSON.stringify([file]));imageEdit.append('reference_images',new Blob(['replacement-image'],{type:'image/png'}),'replacement.png');
    await expect(`projects/${id}`,'PATCH',doug,imageEdit,200);
    assert.equal((await request(`files/${file}`,'GET',doug)).status,404);
    const changed=await expect(`projects/${id}`,'GET',doug,null,200);assert.equal(changed.reference_files.length,1);
    assert.equal(await (await request(`files/${changed.reference_files[0].id}`,'GET',doug)).text(),'replacement-image');
    await expect(`projects/${id}/acceptance`,'PATCH',doug,{decision:'accepted'},403);
    await expect(`projects/${id}/archive`,'PATCH',doug,{archived:true},403);
    await expect(`projects/${id}/archive`,'PATCH',admin,{archived:true},409);
    await expect(`projects/${id}/status`,'PATCH',admin,{status:'In Production'},409);
    await expect(`projects/${id}/designs`,'POST',admin,new FormData(),409);
    await expect(`projects/${id}`,'PATCH',doug,{name:'',internal_notes:'Injected'},400);
    await expect(`projects/${id}`,'PATCH',doug,{metal:'18K',internal_notes:'Injected',acceptance_status:'accepted'},200);
    const edited=(await expect(`projects/${id}`,'GET',admin,null,200)).project;assert.equal(edited.metal,'18K');assert.equal(edited.internal_notes,'');assert.equal(edited.acceptance_status,'pending');
    await expect(`projects/${id}/acceptance`,'PATCH',atit,{decision:'accepted'},200);
    assert.equal(messages.length,2);assert.deepEqual(messages[1].to,['doug@uniqjewelry.com']);assert.equal(messages[1].template.id,'658dca8b-7312-42f1-80e3-2febf835a364');assert.equal(messages[1].template.variables.CUSTOMER_NAME,'Doug');
    await expect(`projects/${id}/acceptance`,'PATCH',admin,{decision:'accepted'},409);assert.equal(messages.length,2);
    await expect(`projects/${id}`,'PATCH',doug,{name:'Cannot edit accepted'},403);
    await expect(`projects/${id}/archive`,'PATCH',admin,{archived:true},200);
    const archived=(await expect('projects','GET',doug,null,200)).projects.find(p=>p.id===id);assert.equal(archived.archived,1);assert.equal(archived.status,'Project Received');
    await expect(`projects/${id}/archive`,'PATCH',atit,{archived:false},200);
    const declined=(await expect('projects','POST',doug,form('Decline me'),201)).project;
    await expect(`projects/${declined.id}/acceptance`,'PATCH',admin,{decision:'declined'},200);assert.equal(messages.length,3);
    await expect(`projects/${declined.id}`,'PATCH',doug,{name:'Cannot edit declined'},403);
    await expect(`projects/${declined.id}/acceptance`,'PATCH',admin,{decision:'accepted'},409);
    await expect(`projects/${declined.id}`,'GET',doug,null,200);
    globalThis.fetch=async()=>new Response('Temporary email failure',{status:503});
    const noDate=form('Email failure');noDate.set('requested_delivery_date','');
    const failedEmail=await expect('projects','POST',doug,noDate,201);assert.match(failedEmail.notification_warning,/503/);assert.equal(failedEmail.project.acceptance_status,'pending');
    const acceptedDespiteEmail=await expect(`projects/${failedEmail.project.id}/acceptance`,'PATCH',admin,{decision:'accepted'},200);assert.match(acceptedDespiteEmail.notification_warning,/503/);
    await expect(`projects/${failedEmail.project.id}`,'DELETE',admin,null,200);
    const direct=await expect('projects','POST',admin,form('Admin direct'),201);assert.equal(direct.project.acceptance_status,'accepted');assert.equal(messages.length,3);
    for(const projectId of [id,declined.id,direct.project.id])await expect(`projects/${projectId}`,'DELETE',admin,null,200);
    assert.equal(objects.size,0);
  }finally{globalThis.fetch=originalFetch;sqlite.close()}
});
