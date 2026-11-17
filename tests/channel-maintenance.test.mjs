import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import { mountChannelMaintenance } from '../backend/channel-maintenance.mjs';
const env={MANUS_JWT_SECRET:'offline-test-secret-not-a-live-credential',MANUS_PROJECT_ID:'offline-project'};
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
async function token(openId='cron_offline',project=env.MANUS_PROJECT_ID) {
  return new SignJWT({appId:project,openId}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(env.MANUS_JWT_SECRET));
}
async function request({cookie='',registered=true,identity={},body={},result={refreshed:2,secret:'never-return-this'},run}={}) {
  const calls=[];
  const db={query:async(sql,args)=>{calls.push({sql,args});return sql.startsWith('SELECT')?(registered?[{task_uid:'offline-task'}]:[]):{affectedRows:1};}};
  const app=express(); app.use(cookieParser()); app.use(express.json());
  let ran=0;
  mountChannelMaintenance(app,db,env,wrap,async(...args)=>{ran++;if(run) return run(...args);return result;},{identity:async()=>({taskUid:'offline-task',projectId:env.MANUS_PROJECT_ID,openId:'cron_offline',...identity})});
  app.use((e,req,res,next)=>res.status(e.status||500).json({error:{code:e.code||'failed'}}));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/scheduled/youtube-maintenance`,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),calls,ran};
  } finally {await new Promise(resolve=>server.close(resolve));}
}
test('maintenance rejects missing scheduler ticket before database access',async()=>{
  const r=await request();assert.equal(r.status,401);assert.equal(r.calls.length,0);assert.equal(r.ran,0);
});
test('a normal user session never grants maintenance authority',async()=>{
  const r=await request({cookie:`app_session_id=${await token('ordinary-user')}`});assert.equal(r.status,403);assert.equal(r.calls.length,0);assert.equal(r.ran,0);
});
test('signed but wrong project or identity cannot operate a registered maintenance task',async()=>{
  const r=await request({cookie:`app_session_id=${await token('cron_offline','other-project')}`});assert.equal(r.status,403);assert.equal(r.ran,0);
  const mismatch=await request({cookie:`app_session_id=${await token()}`,identity:{taskUid:'foreign-task'}});assert.equal(mismatch.status,403);assert.equal(mismatch.ran,0);
});
test('scheduler identity must match its signed JWT and registered task',async()=>{
  const r=await request({cookie:`app_session_id=${await token()}`,identity:{openId:'cron_another'}});assert.equal(r.status,403);assert.equal(r.calls.length,0);
  const missing=await request({cookie:`app_session_id=${await token()}`,registered:false});assert.equal(missing.status,403);assert.equal(missing.ran,0);
});
test('registered callback ignores body selectors and only returns safe maintenance counts',async()=>{
  const r=await request({cookie:`app_session_id=${await token()}`,body:{workspaceId:'foreign-workspace',taskUid:'forged'},run:async(db,settings,services)=>{assert.equal(settings,env);assert.equal('workspaceId' in services,false);return {refreshed:3,deleted:1,token:'do-not-return',detail:{private:'do-not-return'}};}});
  assert.equal(r.status,200);assert.equal(r.ran,1);assert.deepEqual(r.data,{ok:true,refreshed:3,deleted:1});
});
test('a disabled engine callback is not recorded as successful active maintenance',async()=>{
  const r=await request({cookie:`app_session_id=${await token()}`,result:{disabled:true,processed:0}});assert.equal(r.status,200);
  const update=r.calls.find(x=>x.sql.includes('last_success_at=CASE'));assert.equal(update.args[0],'disabled');assert.equal(update.args[2],false);
});
test('partial maintenance failure retries and does not overwrite last successful run',async()=>{
  const r=await request({cookie:`app_session_id=${await token()}`,result:{failed:1,checked:2}});
  assert.equal(r.status,503);assert.equal(r.data.ok,false);
  const update=r.calls.find(x=>x.sql.includes('last_success_at=CASE'));assert.equal(update.args[0],'degraded');assert.equal(update.args[2],false);
});
test('expired external revocation is an operator attention state, not a complete success claim',async()=>{
  const r=await request({cookie:`app_session_id=${await token()}`,result:{failed:0,revocationExpired:1}});
  assert.equal(r.status,200);
  const update=r.calls.find(x=>x.sql.includes('last_success_at=CASE'));assert.equal(update.args[0],'degraded');assert.equal(update.args[2],false);
});
