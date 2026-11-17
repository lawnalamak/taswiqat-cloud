import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { once } from 'node:events';
import { createApp } from '../backend/app.mjs';
import { csrfToken } from '../backend/auth.mjs';
import { configureAdmin } from '../backend/configure-admin.mjs';
const env={MANUS_JWT_SECRET:'offline-fixture-secret-local-only',MANUS_PROJECT_ID:'offline-app'};
const state=()=>({business:{name:'fixture',type:'retail',market:'',website:'',bio:''},selected:['ig'],posts:[],campaigns:[],team:[],theme:'light'});
async function jwt(claims={}) {return new SignJWT({openId:'fixture-open-id',appId:env.MANUS_PROJECT_ID,...claims}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(env.MANUS_JWT_SECRET));}
function fixtureDb({workspace=true,version=3}={}) {
  const queries=[];
  const db={queries,query:async(sql,args=[])=>{
    queries.push(sql);
    if (sql.includes('revocations')) return [];
    if (sql.includes('taswiqat_users')) return [{id:'fixture-user',open_id:'fixture-open-id',name:'fixture',email:'fixture@example.invalid',role:'user',status:'active'}];
    if (sql.includes('JOIN taswiqat_memberships')) return workspace?[{id:'fixture-workspace',state_json:state(),member_role:'owner',member_status:'active',status:'active',version}]:[];
    throw new Error('Unexpected query in offline fixture: '+sql);
  },transaction:async fn=>fn(db)};
  return db;
}
async function withServer(db,fn) {
  const server=createApp({db,env}).listen(0,'127.0.0.1');await once(server,'listening');
  try{return await fn(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(r=>server.close(r));}
}
test('forged admin claim still cannot call admin API; unsafe request requires session HMAC',async()=>{
  const db=fixtureDb();const signed=await jwt({role:'admin',email:'admin@example.invalid'});
  await withServer(db,async base=>{
    const response=await fetch(base+'/api/admin/state',{headers:{Cookie:`webdev_app_session=${signed}`}});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'admin_required');
    const missingCsrf=await fetch(base+'/api/workspaces',{method:'POST',headers:{Cookie:`webdev_app_session=${signed}`,'Content-Type':'application/json'},body:JSON.stringify({business:state().business,selected:['ig']})});assert.equal(missingCsrf.status,403);assert.equal((await missingCsrf.json()).error.code,'csrf_invalid');
  });
  assert.ok(db.queries.every(q=>q.startsWith('SELECT')));
});
test('cross-workspace ID never reveals another workspace',async()=>{
  const db=fixtureDb({workspace:false});const signed=await jwt();
  await withServer(db,async base=>{
    const response=await fetch(base+'/api/workspaces/another-workspace/state',{headers:{Cookie:`webdev_app_session=${signed}`}});
    assert.equal(response.status,404);assert.equal((await response.json()).error.code,'workspace_not_found');
  });
  assert.ok(db.queries.every(q=>q.startsWith('SELECT')));
});
test('stale workspace version produces 409 without UPDATE or overwrite',async()=>{
  const db=fixtureDb({version:5});const signed=await jwt();
  await withServer(db,async base=>{
    const response=await fetch(base+'/api/workspaces/fixture-workspace/state',{method:'PUT',headers:{Cookie:`webdev_app_session=${signed}`,'Content-Type':'application/json','X-CSRF-Token':csrfToken(signed,env)},body:JSON.stringify({state:state(),version:4})});
    assert.equal(response.status,409);assert.equal((await response.json()).error.code,'version_conflict');
  });
  assert.ok(db.queries.every(q=>q.startsWith('SELECT')));
});
test('admin allowlist changes require explicit CLI change and never pin from the email command',async()=>{
  const queries=[];
  const tx={query:async(sql,args)=>{queries.push({sql,args});if(sql.startsWith('SELECT'))return [{email:'old@example.invalid',pinned_open_id:'old-open-id'}];return {affectedRows:1};}};
  const db={transaction:fn=>fn(tx)};
  await assert.rejects(configureAdmin(db,'new@example.invalid',false),e=>e.code==='explicit_change_required');
  assert.equal(queries.length,1);
  queries.length=0;await configureAdmin(db,'new@example.invalid',true);
  assert.ok(queries.some(q=>q.sql.includes("role='user'")));
  assert.ok(queries.some(q=>q.sql.includes('pinned_open_id=NULL')));
  assert.ok(!queries.some(q=>/SET\s+role\s*=\s*'admin'/i.test(q.sql)));
});
test('workspace PUT enforces the union of planned and registered channels without double counting',async()=>{
  const db=fixtureDb();const original=db.query;let updates=0;
  db.query=async(sql,args)=>{
    if(sql.includes('FROM taswiqat_memberships m JOIN taswiqat_users'))return [];
    if(sql.includes('FROM taswiqat_subscriptions'))return [{status:'active',plan_json:{channels:2,members:1}}];
    if(sql.includes('SELECT provider FROM taswiqat_connections'))return [{provider:'yt'}];
    if(sql.startsWith('UPDATE taswiqat_workspaces')){updates++;return {affectedRows:1};}
    if(sql.startsWith('INSERT INTO taswiqat_audit'))return {affectedRows:1};
    return original(sql,args);
  };
  const signed=await jwt();const headers={Cookie:`webdev_app_session=${signed}`,'Content-Type':'application/json','X-CSRF-Token':csrfToken(signed,env)};
  await withServer(db,async base=>{
    const input=state();input.selected=['ig','tt'];
    const tooMany=await fetch(base+'/api/workspaces/fixture-workspace/state',{method:'PUT',headers,body:JSON.stringify({state:input,version:3})});
    assert.equal(tooMany.status,409);assert.equal((await tooMany.json()).error.code,'channel_quota');assert.equal(updates,0);
    input.selected=['yt','ig'];
    const allowed=await fetch(base+'/api/workspaces/fixture-workspace/state',{method:'PUT',headers,body:JSON.stringify({state:input,version:3})});
    assert.equal(allowed.status,200);assert.equal(updates,1);
  });
});
