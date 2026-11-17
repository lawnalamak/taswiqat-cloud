import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import { createApp } from '../backend/app.mjs';
import { TABLES } from '../backend/migrate.mjs';
import { publicChannelConnection } from '../backend/channel-public.mjs';
import { registerChannelMaintenance } from '../backend/register-channel-maintenance.mjs';
const env={MANUS_JWT_SECRET:'offline-integration-fixture-not-production',MANUS_PROJECT_ID:'offline-integration'};
const origin='https://taswiqat.manus.space';
async function session(role='user') {
  return new SignJWT({openId:role,appId:env.MANUS_PROJECT_ID,origin}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(env.MANUS_JWT_SECRET));
}
function memoryDb() {
  const db={calls:[],query:async(sql,args=[])=>{
    db.calls.push(sql);
    if(sql.includes('taswiqat_revocations'))return [];
    if(sql.includes('taswiqat_private_admin'))return [{pinned_open_id:'admin'}];
    if(sql.includes('taswiqat_users'))return [{id:args[0]==='admin'?'admin':'u1',open_id:args[0],status:'active',role:args[0]==='admin'?'admin':'user',session_version:0}];
    if(sql.includes('JOIN taswiqat_memberships'))return args[0]==='w1' && args[1]==='u1'?[{id:'w1',member_role:'owner',member_status:'active',status:'active',state_json:{selected:[]}}]:[];
    if(sql.includes('taswiqat_subscriptions'))return [{status:'active',plan_json:{active:true,channels:2,members:1}}];
    if(sql.includes('information_schema.tables'))return TABLES.map(table_name=>({table_name}));
    if(sql.includes('MAX(version)'))return [{version:4}];
    if(sql.includes('taswiqat_revision'))return [{version:10}];
    if(sql.includes('COUNT(*)') && sql.includes('taswiqat_plans'))return [{n:3}];
    if(sql.includes('site_settings'))return [{id:1,site_json:{contactEmail:''}}];
    if(sql.includes('taswiqat_plans'))return [{data_json:{id:'basic',price:49,active:true}}];
    if(sql.startsWith('SELECT 1'))return [{ok:1}];
    return [];
  }};
  return db;
}
async function withApp(fn,db=memoryDb()) {
  const server=createApp({db,env}).listen(0,'127.0.0.1');await once(server,'listening');
  try{return await fn(`http://127.0.0.1:${server.address().port}`,db);}finally{await new Promise(r=>server.close(r));}
}
test('mounted YouTube status requires real application session and keeps exact disabled contract',async()=>withApp(async base=>{
  assert.equal((await fetch(base+'/api/oauth/google/status?workspaceId=w1')).status,401);
  const r=await fetch(base+'/api/oauth/google/status?workspaceId=w1',{headers:{Cookie:`webdev_app_session=${await session()}`}});
  assert.equal(r.status,200);assert.deepEqual(Object.keys(await r.json()).sort(),['ready','reason','mode','policyVersion','connection','pending'].sort());
}));
test('channel callback failure is fixed, no-referrer and never echoes code or provider error',async()=>withApp(async base=>{
  const r=await fetch(base+'/api/oauth/google/callback?code=PRIVATE_CODE&error=PRIVATE_ERROR&workspace=foreign',{redirect:'manual'});
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),origin+'/?workspace=&youtube=failed#app');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
}));
test('publisher capabilities without workspace remain fail-closed and foreign workspace cannot borrow authority',async()=>withApp(async base=>{
  const headers={Cookie:`webdev_app_session=${await session()}`};
  const r=await fetch(base+'/api/publisher/capabilities',{headers});const d=await r.json();
  assert.equal(d.publishing,false);assert.equal(d.scheduling,false);assert.ok(d.channels.every(c=>!c.connected && !c.read && !c.publish && !c.schedule));
  assert.equal((await fetch(base+'/api/publisher/capabilities?workspaceId=w2',{headers})).status,404);
  const own=await fetch(base+'/api/publisher/capabilities?workspaceId=w1',{headers});assert.equal(own.status,200);assert.equal((await own.json()).youtube.ready,false);
}));
test('integration metadata is admin-only and never returns keys, administrator email or task ticket',async()=>withApp(async base=>{
  assert.equal((await fetch(base+'/api/admin/integrations')).status,401);
  assert.equal((await fetch(base+'/api/admin/integrations',{headers:{Cookie:`webdev_app_session=${await session()}`}})).status,403);
  const r=await fetch(base+'/api/admin/integrations',{headers:{Cookie:`webdev_app_session=${await session('admin')}`}});assert.equal(r.status,200);
  const d=await r.json();assert.equal(d.youtube.ready,false);assert.equal(d.maintenance.registered,false);assert.equal(d.supportContactConfigured,false);
  assert.doesNotMatch(JSON.stringify(d),/offline-integration-fixture|CLIENT_SECRET|TOKEN_KEY|task_uid|@/);
}));
test('scheduled handler is mounted ahead of user API gate and ordinary session cannot invoke it',async()=>withApp(async base=>{
  const r=await fetch(base+'/api/scheduled/youtube-maintenance',{method:'POST',headers:{Cookie:`webdev_app_session=${await session()}`,'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,401);assert.equal((await r.json()).error.code,'maintenance_authentication_required');
}));
const now=Date.now();const details={channelId:'UC'+'a'.repeat(22),title:'<القناة>',thumbnailUrl:'https://attacker.invalid/image',url:'https://attacker.invalid',verifiedAt:new Date(now).toISOString(),scope:'readonly',access_token:'DO_NOT_RETURN',refresh_token:'DO_NOT_RETURN'};
test('workspace/admin projection strips unlisted metadata and expired/future YouTube identity',()=>{
  const row={id:'c1',workspace_id:'w1',provider:'yt',status:'connected',public_json:details};
  const fresh=publicChannelConnection(row,{workspace:true,now});assert.equal(fresh.workspaceId,'w1');assert.equal(fresh.details.thumbnailUrl,'');assert.equal(fresh.details.url,'https://www.youtube.com/channel/'+details.channelId);assert.doesNotMatch(JSON.stringify(fresh),/DO_NOT_RETURN|attacker/);
  for(const verifiedAt of [new Date(now-30*86400000).toISOString(),new Date(now+120000).toISOString(),'not-a-date']) {
    const stale=publicChannelConnection({...row,public_json:{...details,verifiedAt}},{now});assert.equal(stale.status,'stale');assert.equal(stale.details,null);
  }
  assert.equal(publicChannelConnection({...row,public_json:{...details,scope:'upload'}},{now}).details,null);
});
test('maintenance registration validates schema and UID, is idempotent and refuses silent replacement',async()=>{
  let uid=null,writes=0;
  const db={query:async()=>[{version:4}],transaction:async fn=>fn({query:async(sql,args)=>{if(sql.startsWith('SELECT'))return uid?[{task_uid:uid}]:[];writes++;if(sql.startsWith('INSERT INTO taswiqat_channel_maintenance'))uid=args[1];return {affectedRows:1};}})};
  await assert.rejects(registerChannelMaintenance(db,'../bad'));
  assert.deepEqual(await registerChannelMaintenance(db,'task_one'),{registered:true,unchanged:false});const count=writes;
  assert.deepEqual(await registerChannelMaintenance(db,'task_one'),{registered:true,unchanged:true});assert.equal(writes,count);
  await assert.rejects(registerChannelMaintenance(db,'task_two'));assert.equal(uid,'task_one');
  await assert.rejects(registerChannelMaintenance({...db,query:async()=>[{version:3}]},'task_one'));
});
test('logout revocation and YouTube attempt deletion share the canonical mutation transaction',async()=>{
  const db=memoryDb(),original=db.query;let inside=false,revoked=false,deleted=false;
  db.transaction=async fn=>{inside=true;try{return await fn(db);}finally{inside=false;}};
  db.query=async(sql,args)=>{
    if(sql.startsWith('INSERT IGNORE INTO taswiqat_revocations')){assert.equal(inside,true);revoked=true;return {affectedRows:1};}
    if(sql.startsWith('DELETE FROM taswiqat_youtube_attempts')){assert.equal(inside,true);assert.equal(args[0],'u1');assert.match(args[1],/^[a-f0-9]{64}$/);deleted=true;return {affectedRows:1};}
    if(sql.startsWith('SELECT token_hash FROM taswiqat_revocations'))return revoked?[{token_hash:'offline'}]:[];
    return original(sql,args);
  };
  const {csrfToken}=await import('../backend/auth.mjs');const jwt=await session();
  await withApp(async base=>{
    const r=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:`webdev_app_session=${jwt}`,'Content-Type':'application/json','X-CSRF-Token':csrfToken(jwt,env),Origin:origin},body:'{}'});
    assert.equal(r.status,200);assert.equal(revoked,true);assert.equal(deleted,true);
    const status=await fetch(base+'/api/oauth/google/status?workspaceId=w1',{headers:{Cookie:`webdev_app_session=${jwt}`}});assert.equal(status.status,401);
  },db);
});
