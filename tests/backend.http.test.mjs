import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp,readiness } from '../backend/app.mjs';
import { createDatabase } from '../backend/db.mjs';
async function withServer(app,fn) {
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve=>server.close(resolve)); }
}
const offlineDb={query:async()=>{throw new Error('offline only');}};
test('HTTP logged-out session, protected APIs and unknown API JSON 404',async()=>{
  await withServer(createApp({db:offlineDb,env:{}}),async base=>{
    const session=await fetch(base+'/api/session');assert.equal(session.status,200);assert.deepEqual(await session.json(),{authenticated:false});
    const admin=await fetch(base+'/api/admin/state');assert.equal(admin.status,401);assert.equal((await admin.json()).error.code,'authentication_required');
    const unknown=await fetch(base+'/api/does-not-exist');assert.equal(unknown.status,404);assert.match(unknown.headers.get('content-type'),/application\/json/);
    const health=await fetch(base+'/api/health');assert.equal(health.status,503);assert.deepEqual(await health.json(),{ready:false,database:false,schema:false});
  });
});
test('all reserved social OAuth provider paths explicitly unavailable, never fake success',async()=>{
  await withServer(createApp({db:offlineDb,env:{}}),async base=>{
    for (const provider of ['google','meta','tiktok','snapchat','x']) {
      const response=await fetch(`${base}/api/oauth/${provider}/connect?service=instagram`);
      assert.equal(response.status,503);assert.equal((await response.json()).error.code,'integration_not_configured');
    }
  });
});
test('public settings endpoint alone has anonymous CORS, plans from canonical DB rows',async()=>{
  const db={query:async sql=>sql.includes('site_settings')?[{site_json:JSON.stringify({heroLine1:'كل قنواتك.',heroLine2:'مكان واحد.',heroDescription:'وصف',contactEmail:'',notice:''})}]:[{data_json:JSON.stringify({id:'basic',name:'الأساسية',price:199,channels:2,members:1,active:true})}]};
  await withServer(createApp({db,env:{}}),async base=>{
    const response=await fetch(base+'/api/public/settings',{headers:{Origin:'https://marketing.example'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('access-control-allow-credentials'),null);
    assert.equal((await response.json()).plans[0].enabled,true);
    const session=await fetch(base+'/api/session',{headers:{Origin:'https://marketing.example'}});assert.equal(session.headers.get('access-control-allow-origin'),null);
  });
});
test('OAuth start missing config/invalid origin never returns invented URL',async()=>{
  await withServer(createApp({db:offlineDb,env:{}}),async base=>{
    const response=await fetch(base+'/api/auth/start?origin=https://example.invalid&target=app');
    assert.equal(response.status,503);assert.equal((await response.json()).error.code,'auth_not_configured');
  });
});
test('static route manifest is JSON and traversal cannot expose source/secrets',async()=>{
  await withServer(createApp({db:offlineDb,env:{}}),async base=>{
    const response=await fetch(base+'/manus-routes.json');assert.equal(response.status,200);assert.ok(Array.isArray((await response.json()).routes));
    for (const requested of ['/backend/auth.mjs','/.env','/%2e%2e/backend/auth.mjs','/missing-asset.js']) {
      const r=await fetch(base+requested);assert.equal(r.status,404);assert.equal((await r.json()).error.code,'not_found');
    }
  });
});
test('real managed DB health uses only SELECT and releases its pool (no migrations/seeds/test writes)',{skip:!process.env.DATABASE_URL},async()=>{
  const db=createDatabase();
  const original=db.query;
  db.query=(sql,args)=>{assert.match(sql.trim(),/^SELECT\b/i);return original(sql,args);};
  try {
    const health=await readiness(db);
    assert.equal(typeof health.ready,'boolean');assert.equal(typeof health.schema,'boolean');
    assert.equal(health.database,true,'actual database connectivity must succeed');
    console.log('Read-only managed DB health:',JSON.stringify(health));
  } finally {await db.close();}
});
