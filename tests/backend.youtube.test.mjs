import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { ApiError, digest } from '../backend/validation.mjs';
import { mountChannelMaintenance } from '../backend/channel-maintenance.mjs';
import { csrfToken, authMiddleware, mountAuthRoutes, SESSION_COOKIE } from '../backend/auth.mjs';
import { YOUTUBE_TABLE_NAMES, YOUTUBE_DEFINITIONS } from '../backend/youtube-schema.mjs';
import { POLICY_VERSION,YOUTUBE_SCOPE,YOUTUBE_STATE_COOKIE,mountYouTubeRoutes,youtubeCapabilities,runYouTubeMaintenance,youtubeConfiguration,youtubeReadiness,encryptYouTubeEnvelope,decryptYouTubeEnvelope,validateYouTubeToken,verifiedYouTubeChannel } from '../backend/youtube.mjs';

const origin='https://taswiqat.manus.space';
const DAY=86400000;
const channelId='UC'+'a'.repeat(22),otherId='UC'+'b'.repeat(22);
const env={MANUS_JWT_SECRET:'OFFLINE_ONLY_CSRF_KEY',MANUS_PROJECT_ID:'offline-yt',TASWIQAT_YOUTUBE_CLIENT_ID:'offline.apps.googleusercontent.com',TASWIQAT_YOUTUBE_CLIENT_SECRET:'OFFLINE_ONLY_CLIENT_SECRET',TASWIQAT_YOUTUBE_TOKEN_KEY:randomBytes(32).toString('base64'),TASWIQAT_YOUTUBE_MODE:'testing',TASWIQAT_YOUTUBE_TEST_USER_IDS:'u1,u2'};
const sessionTokens={};
async function signedSession(user='u1',label='one',exp=Math.floor(Date.now()/1000)+7*DAY/1000) {
  return new SignJWT({openId:'offline:'+user,appId:env.MANUS_PROJECT_ID,origin,sv:0,jti:label}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(env.MANUS_JWT_SECRET));
}
for (const user of ['u1','u2','employee']) {
  sessionTokens[user]={};for (const label of ['one','other','e']) sessionTokens[user][label]=await signedSession(user,label);
}
const sessionCookie=(user='u1',label='one')=>`${SESSION_COOKIE}=${sessionTokens[user][label]}`;
const rawChannel=(id=channelId)=>({id,snippet:{title:'قناة اختبار محلية',thumbnails:{medium:{url:'https://yt3.ggpht.com/offline-image'}}}});
const rawToken=(extra={})=>({access_token:'OFFLINE_ACCESS_TOKEN',refresh_token:'OFFLINE_REFRESH_TOKEN',token_type:'Bearer',expires_in:3600,scope:YOUTUBE_SCOPE,...extra});
function sqlLimit(sql) {
  const match=sql.match(/\bLIMIT ([1-9]\d*)$/);
  assert.ok(match,'maintenance LIMIT must be a numeric SQL literal, not a bound argument');
  const limit=Number(match[1]);assert.ok(Number.isInteger(limit) && limit<=100);
  return limit;
}
function memoryDb() {
  let state={schema:4,tables:[...YOUTUBE_TABLE_NAMES],users:['u1','u2','employee'].map(id=>({id,open_id:'offline:'+id,session_version:0,role:'user',status:'active'})),workspaces:[{id:'w1',status:'active',state_json:{selected:['yt']},members:{u1:'owner',u2:'manager',employee:'employee'},subscription:{status:'active'},plan:{active:true,channels:2}},{id:'w2',status:'active',state_json:{selected:[]},members:{u1:'owner',u2:'manager'},subscription:{status:'active'},plan:{active:true,channels:2}}],connections:[],tokens:[],attempts:[],revocations:[],sessionRevocations:[]};
  const statements=[];let queue=Promise.resolve(),locks=0;
  const db={get state(){return state;},get locks(){return locks;},statements,async query(sql,a=[]) {
    statements.push({sql,args:a});
    const select=sql.startsWith('SELECT');
    if (sql.startsWith('SELECT MAX(version)')) return [{version:state.schema}];
    if (sql.startsWith('SELECT site_json')) return [{site_json:state.publicSite || {}}];
    if (sql.includes('information_schema.tables')) return state.tables.map(table_name=>({table_name}));
    if (select && sql.includes('taswiqat_revocations')) return structuredClone(state.sessionRevocations.filter(r=>r.token_hash===a[0] && r.expires_at>Date.now()));
    if (sql.startsWith('INSERT IGNORE INTO taswiqat_revocations')) {if (!state.sessionRevocations.some(r=>r.token_hash===a[0])) state.sessionRevocations.push({token_hash:a[0],expires_at:a[1]});return {affectedRows:1};}
    if (select && sql.includes('taswiqat_private_admin')) return [{pinned_open_id:state.adminPin || null}];
    if (select && sql.includes('taswiqat_users')) return structuredClone(state.users.filter(u=>sql.includes('open_id=?')?u.open_id===a[0]:u.id===a[0]));
    if (select && sql.includes('taswiqat_workspaces')) {
      const w=state.workspaces.find(w=>w.id===a[0]);return w?.members[a[1]] ? [{...structuredClone(w),member_role:w.members[a[1]],member_status:w.suspendedMembers?.includes(a[1])?'suspended':'active'}] : [];
    }
    if (select && sql.includes('taswiqat_subscriptions')) {
      const w=state.workspaces.find(w=>w.id===a[0]);return w ? [{...structuredClone(w.subscription),plan_json:structuredClone(w.plan)}] : [];
    }
    if (select && sql.includes('JOIN taswiqat_youtube_tokens')) {
      const token=state.tokens.find(t=>t.workspace_id===a[0]);
      return token ? state.connections.filter(c=>c.id===token.connection_id && c.workspace_id===a[0] && c.provider==='yt').map(c=>({...structuredClone(c),token_version:token.token_version,channel_id:token.channel_id,verified_at:token.verified_at})) : [];
    }
    if (select && sql.includes('taswiqat_connections')) return structuredClone(state.connections.filter(c=>c.workspace_id===a[0]));
    if (select && sql.includes('taswiqat_youtube_attempts')) {
      let rows=state.attempts;
      if(sql.includes('state_hash=?')) rows=rows.filter(t=>t.state_hash===a[0]);
      else if(sql.includes('workspace_id=?')) rows=rows.filter(t=>t.workspace_id===a[0]);
      else if(sql.includes('WHERE id=?')) rows=rows.filter(t=>t.id===a[0]);
      else if(sql.includes('expires_at<=?')) rows=rows.filter(t=>t.expires_at<=a[0]).slice(0,sqlLimit(sql));
      return structuredClone(rows);
    }
    if (sql.startsWith('INSERT INTO taswiqat_youtube_attempts')) {
      if(state.attempts.some(t=>t.workspace_id===a[2])) throw Error('offline unique workspace');
      state.attempts.push({state_hash:a[0],id:a[1],workspace_id:a[2],user_id:a[3],session_hash:a[4],cookie_hash:a[5],policy_version:a[6],payload_cipher:a[7],base_connection_id:a[8],base_token_version:a[9],expires_at:a[10],created_at:a[11],service:'yt',status:'started'});return {affectedRows:1};
    }
    if(sql.startsWith('UPDATE taswiqat_youtube_attempts')) {
      if(sql.includes('SET base_token_version=')) {const row=state.attempts.find(t=>t.id===a[1] && t.status==='exchanging' && t.base_token_version===a[2]);if(row)row.base_token_version=a[0];return {affectedRows:row?1:0};}
      const pending=sql.includes("status='pending'");
      const row=state.attempts.find(t=>t.id===a[pending?2:0] && t.status===(pending?'exchanging':'started') && (pending || t.expires_at>a[1]));
      if(row) {row.status=pending?'pending':'exchanging';if(pending){row.payload_cipher=a[0];row.expires_at=a[1];}}
      return {affectedRows:row?1:0};
    }
    if(sql.startsWith('DELETE FROM taswiqat_youtube_attempts')) {
      const n=state.attempts.length;
      state.attempts=state.attempts.filter(t=>sql.includes('WHERE id=?')?t.id!==a[0]:sql.includes('WHERE user_id=?')?!(t.user_id===a[0] && t.session_hash===a[1]):!(t.workspace_id===a[0] && (!sql.includes('user_id=?') || (t.user_id===a[1] && t.session_hash===a[2]))));return {affectedRows:n-state.attempts.length};
    }
    if(select && sql.includes('taswiqat_youtube_tokens')) {
      const retention=sql.includes('WHERE verified_at<=?');
      const rows=sql.includes('workspace_id=?')?state.tokens.filter(t=>t.workspace_id===a[0]):state.tokens.filter(t=>(retention?t.verified_at<=a[0] && (t.token_cipher!=='' || t.channel_id!==''):t.next_check_at<=a[0]) && (!t.lease_until || t.lease_until<=a[1])).sort((a,b)=>retention?a.verified_at-b.verified_at:a.next_check_at-b.next_check_at).slice(0,sqlLimit(sql));
      return structuredClone(rows);
    }
    if(sql.startsWith('INSERT INTO taswiqat_youtube_tokens')) {
      if(state.tokens.some(t=>t.workspace_id===a[0])) throw Error('offline unique workspace');
      state.tokens.push({workspace_id:a[0],connection_id:a[1],user_id:a[2],channel_id:a[3],token_cipher:a[4],verified_at:a[5],next_check_at:a[6],token_version:1,retry_count:0,reconsent_required:false,lease_owner:null,lease_until:null});return {affectedRows:1};
    }
    if(sql.startsWith('UPDATE taswiqat_youtube_tokens')) {
      let row;
      if(sql.includes('SET lease_owner=')) {
        row=state.tokens.find(t=>t.workspace_id===a[2] && t.token_version===a[3] && (!t.lease_until || t.lease_until<=a[4]));
        if(row){row.lease_owner=a[0];row.lease_until=a[1];}
      } else if(sql.includes('SET reconsent_required=TRUE')) {
        row=state.tokens.find(t=>t.workspace_id===a[0] && t.connection_id===a[1] && t.token_version===Number(a[2]));if(row)row.reconsent_required=true;
      } else if(sql.includes('SET user_id=')) {
        row=state.tokens.find(t=>t.workspace_id===a[5]);if(row)Object.assign(row,{user_id:a[0],channel_id:a[1],token_cipher:a[2],token_version:row.token_version+1,reconsent_required:false,verified_at:a[3],next_check_at:a[4],retry_count:0,lease_owner:null,lease_until:null});
      } else if(sql.includes('token_cipher=?')) {
        if(sql.includes('verified_at=')) {
          row=state.tokens.find(t=>t.workspace_id===a[3]);if(row)Object.assign(row,{token_cipher:a[0],token_version:row.token_version+1,verified_at:a[1],next_check_at:a[2],retry_count:0,lease_owner:null,lease_until:null});
        } else {row=state.tokens.find(t=>t.workspace_id===a[2]);if(row)Object.assign(row,{channel_id:'',token_cipher:a[0],token_version:row.token_version+1,next_check_at:a[1],retry_count:0,lease_owner:null,lease_until:null});}
      } else if(sql.includes('SET next_check_at=')) {row=state.tokens.find(t=>t.workspace_id===a[1]);if(row)Object.assign(row,{next_check_at:a[0],retry_count:row.retry_count+1,lease_owner:null,lease_until:null});}
      else throw Error('unhandled offline token update');
      return {affectedRows:row?1:0};
    }
    if(sql.startsWith('DELETE FROM taswiqat_youtube_tokens')) {const n=state.tokens.length;state.tokens=state.tokens.filter(t=>t.workspace_id!==a[0]);return {affectedRows:n-state.tokens.length};}
    if(sql.startsWith('DELETE FROM taswiqat_connections')) {const n=state.connections.length;state.connections=state.connections.filter(t=>t.workspace_id!==a[0] || t.provider!=='yt');return {affectedRows:n-state.connections.length};}
    if(sql.startsWith('INSERT INTO taswiqat_connections')) {state.connections.push({id:a[0],workspace_id:a[1],provider:'yt',status:'connected',public_json:JSON.parse(a[2])});return {affectedRows:1};}
    if(sql.startsWith('UPDATE taswiqat_connections')) {
      const connected=sql.includes("status='connected'");const row=state.connections.find(t=>t.id===a[connected?1:2] && t.workspace_id===a[connected?2:3] && t.provider==='yt');
      if(row){row.status=connected?'connected':a[0];row.public_json=JSON.parse(a[connected?0:1]);}return {affectedRows:row?1:0};
    }
    if(select && sql.includes('taswiqat_youtube_revocations')) {
      let rows;
      if (sql.includes('workspace_id=?')) rows=state.revocations.filter(t=>t.workspace_id===a[0] && t.expires_at>a[1]).slice(0,1);
      else if (sql.includes('WHERE id=?')) rows=state.revocations.filter(t=>t.id===a[0]);
      else if (sql.includes('WHERE (expires_at<=?')) rows=state.revocations.filter(t=>(t.expires_at<=a[0] || t.requested_at<=a[1]) && (!t.lease_until || t.lease_until<=a[2])).sort((a,b)=>a.expires_at-b.expires_at).slice(0,sqlLimit(sql));
      else rows=state.revocations.filter(t=>t.next_attempt_at<=a[0] && t.expires_at>a[1] && t.requested_at>a[2] && (!t.lease_until || t.lease_until<=a[3])).slice(0,sqlLimit(sql));
      return structuredClone(rows);
    }
    if(sql.startsWith('INSERT INTO taswiqat_youtube_revocations')) {state.revocations.push({id:a[0],workspace_id:a[1],token_cipher:a[2],requested_at:a[3],expires_at:a[4],next_attempt_at:a[5],attempts:0,lease_owner:null,lease_until:null});return {affectedRows:1};}
    if(sql.startsWith('DELETE FROM taswiqat_youtube_revocations')) {const n=state.revocations.length;state.revocations=state.revocations.filter(t=>!(t.id===a[0] && (!sql.includes('lease_owner=?') || t.lease_owner===a[1])));return {affectedRows:n-state.revocations.length};}
    if(sql.startsWith('UPDATE taswiqat_youtube_revocations')) {
      const lease=sql.includes('SET lease_owner=');const row=state.revocations.find(t=>t.id===a[lease?2:1] && (lease?(!t.lease_until || t.lease_until<=a[3]):t.lease_owner===a[2]));
      if(row){if(lease){row.lease_owner=a[0];row.lease_until=a[1];}else{row.attempts++;row.next_attempt_at=a[0];row.lease_owner=null;row.lease_until=null;}}return {affectedRows:row?1:0};
    }
    throw Error('Unexpected offline SQL: '+sql);
  },transaction(fn,options={}) {
    const work=queue.then(async()=>{const before=structuredClone(state);locks++;try{return await fn(db);}catch(e){state=before;throw e;}finally{locks--;}});queue=work.catch(()=>{});return work;
  }};
  return db;
}
function provider(db,options={}) {
  const calls=[];let channels=options.channels || [rawChannel()];let token=options.token || rawToken();let refresh=options.refresh || rawToken({access_token:'OFFLINE_REFRESHED_ACCESS',refresh_token:undefined});let tokenFailure=null,channelFailure=null,revokeFailure=false;
  const mock={calls,set channels(v){channels=v;},set token(v){token=v;},set refresh(v){refresh=v;},set tokenFailure(v){tokenFailure=v;},set channelFailure(v){channelFailure=v;},set revokeFailure(v){revokeFailure=v;},async fetcher(url,opts) {
    assert.equal(db.locks,0,'Google network call must not hold ANY DB transaction lock');
    calls.push({url,opts});assert.ok(opts.signal instanceof AbortSignal);
    if(url==='https://oauth2.googleapis.com/token') {
      const form=new URLSearchParams(opts.body);assert.equal(form.get('client_id'),env.TASWIQAT_YOUTUBE_CLIENT_ID);assert.equal(form.get('client_secret'),env.TASWIQAT_YOUTUBE_CLIENT_SECRET);
      if(tokenFailure) return {ok:false,status:tokenFailure.status || 400,json:async()=>({error:tokenFailure.error})};
      return {ok:true,status:200,json:async()=>structuredClone(form.get('grant_type')==='refresh_token'?refresh:token)};
    }
    if(url.startsWith('https://www.googleapis.com/youtube/v3/channels?')) {
      const u=new URL(url);assert.equal(u.searchParams.get('mine'),'true');assert.equal(u.searchParams.get('part'),'id,snippet');assert.ok(!u.searchParams.has('id'));assert.match(opts.headers.Authorization,/^Bearer OFFLINE/);
      if(channelFailure) return {ok:false,status:channelFailure.status || 503,json:async()=>({error:channelFailure.error || 'SECRET_PROVIDER_ERROR'})};
      if(options.pages) return {ok:true,status:200,json:async()=>options.pages[Number(u.searchParams.get('pageToken') || 0)]};
      return {ok:true,status:200,json:async()=>({items:structuredClone(channels)})};
    }
    if(url==='https://oauth2.googleapis.com/revoke') return {ok:!revokeFailure,status:revokeFailure?503:200,json:async()=>({error:'SECRET_PROVIDER_ERROR'})};
    assert.fail('External URL not allowed: '+url);
  }};
  return mock;
}
async function withApp(db,fn,services={},customEnv=env) {
  const app=express();app.use(cookieParser());app.use(express.json({limit:'8kb'}));
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  const authenticate=authMiddleware(db,customEnv);
  mountAuthRoutes(app,db,customEnv,wrap,authenticate);
  mountYouTubeRoutes(app,db,customEnv,wrap,authenticate,services);
  app.use((e,req,res,next)=>res.status(e instanceof ApiError?e.status:500).json({error:{code:e instanceof ApiError?e.code:'internal_error',message:e instanceof ApiError?e.message:'خطأ داخلي'}}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{return await fn(base);}finally{await new Promise(resolve=>server.close(resolve));}
}
const headers=(cookie=sessionCookie(),user='u1',custom={})=>{
  if (user!=='u1') cookie=cookie.replace(/^webdev_app_session=[^;]+/,sessionCookie(user));
  return {Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrfToken(cookie.split(';')[0].split('=')[1],env),...custom};
};
const get=(base,path,cookie=sessionCookie(),user='u1')=>fetch(base+'/api/oauth/google/'+path,{headers:headers(cookie,user),redirect:'manual'});
const post=(base,path,body,cookie=sessionCookie(),user='u1',custom={})=>fetch(base+'/api/oauth/google/'+path,{method:'POST',headers:headers(cookie,user,custom),body:JSON.stringify(body),redirect:'manual'});
async function start(base,workspaceId='w1',cookie=sessionCookie()) {
  const r=await post(base,'connect?service=yt',{workspaceId,policyVersion:POLICY_VERSION},cookie);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  const u=new URL((await r.json()).url);return {url:u,cookie:cookie+'; '+r.headers.get('set-cookie').split(';')[0],state:u.searchParams.get('state')};
}
const callback=(base,s,cookie=s.cookie)=>get(base,'callback?code=OFFLINE_CODE&state='+s.state,cookie);
async function connect(db,p,customEnv=env) {await withApp(db,async base=>{const s=await start(base);const r=await callback(base,s);assert.equal(r.headers.get('location'),`${origin}/?workspace=w1&youtube=connected#app`);},{fetcher:p.fetcher},customEnv);}
const due=db=>{db.state.tokens[0].next_check_at=new Date(Date.now()-1);};

test('schema contract is additive raw DDL with unique workspace, binary nonce and no engine or destructive SQL',()=>{
  assert.equal(POLICY_VERSION,'2026-11-17');assert.equal(YOUTUBE_TABLE_NAMES.length,3);
  for(const [i,ddl] of YOUTUBE_DEFINITIONS.entries()){assert.ok(ddl.startsWith('CREATE TABLE IF NOT EXISTS '+YOUTUBE_TABLE_NAMES[i]));assert.ok(!/ENGINE=|DROP |ALTER |DELETE /i.test(ddl));}
  assert.match(YOUTUBE_DEFINITIONS[0],/workspace_id VARCHAR\(80\) PRIMARY KEY/);assert.match(YOUTUBE_DEFINITIONS[1],/workspace_id VARCHAR\(80\) NOT NULL UNIQUE/);assert.match(YOUTUBE_DEFINITIONS[1],/ascii_bin/);
});
test('configuration gates disabled/testing/production, fixed HTTPS origin and dedicated settings without exposing secrets',()=>{
  assert.equal(youtubeConfiguration({},'u1').ready,false);assert.equal(youtubeConfiguration({...env,TASWIQAT_YOUTUBE_MODE:undefined},'u1').mode,'disabled');assert.equal(youtubeConfiguration(env,'u1').ready,true);assert.equal(youtubeConfiguration(env,'employee').reason,'testing_user_not_allowed');
  assert.equal(youtubeConfiguration({...env,TASWIQAT_YOUTUBE_MODE:'production'}).ready,false);assert.equal(youtubeConfiguration({...env,TASWIQAT_YOUTUBE_MODE:'production',TASWIQAT_YOUTUBE_PRODUCTION_APPROVED:'true',TASWIQAT_YOUTUBE_MAINTENANCE_READY:'true'}).ready,true);
  for(const value of ['http://localhost','https://evil.invalid','https://taswiqat.manus.space/','https://taswiqat.manus.space/path','https://user@taswiqat.manus.space','https://taswiqat.manus.space?x=1']) assert.equal(youtubeConfiguration({...env,TASWIQAT_YOUTUBE_ORIGIN:value}).ready,false);
  assert.equal(youtubeConfiguration({TASWIQAT_GOOGLE_CLIENT_ID:'ACCOUNT_ONLY',TASWIQAT_GOOGLE_CLIENT_SECRET:'ACCOUNT_ONLY'}).ready,false);assert.ok(!JSON.stringify(youtubeConfiguration(env)).includes('OFFLINE'));
});
test('AES-256-GCM random IV, tamper detection, purpose/workspace/record AAD and canonical 32-byte key validation',()=>{
  const a=encryptYouTubeEnvelope({access:'SECRET'},env,'w1','record','tokens'),b=encryptYouTubeEnvelope({access:'SECRET'},env,'w1','record','tokens');assert.notEqual(a,b);assert.deepEqual(decryptYouTubeEnvelope(a,env,'w1','record','tokens'),{access:'SECRET'});assert.ok(!a.includes('SECRET'));
  for(const [w,r,p] of [['w2','record','tokens'],['w1','other','tokens'],['w1','record','pending']]) assert.throws(()=>decryptYouTubeEnvelope(a,env,w,r,p),e=>e.code==='integration_data_unavailable');
  const damaged=JSON.parse(a);damaged.data=(damaged.data[0]==='a'?'b':'a')+damaged.data.slice(1);assert.throws(()=>decryptYouTubeEnvelope(JSON.stringify(damaged),env,'w1','record','tokens'));
  for(const key of ['',randomBytes(31).toString('base64'),randomBytes(33).toString('base64'),'x'.repeat(44),env.TASWIQAT_YOUTUBE_TOKEN_KEY+'\n']) assert.throws(()=>encryptYouTubeEnvelope({}, {...env,TASWIQAT_YOUTUBE_TOKEN_KEY:key},'w1','r','tokens'),e=>e.code==='integration_not_configured');
  assert.throws(()=>decryptYouTubeEnvelope(a,{...env,TASWIQAT_YOUTUBE_TOKEN_KEY:randomBytes(32).toString('base64')},'w1','record','tokens'));
});
test('only exact readonly returned scope/Bearer/bounded expiry and server-verified UC channel metadata are accepted',()=>{
  assert.equal(validateYouTubeToken(rawToken()).scope,YOUTUBE_SCOPE);
  for(const patch of [{scope:undefined},{scope:YOUTUBE_SCOPE+' openid'},{scope:'https://www.googleapis.com/auth/youtube'},{token_type:'bearer'},{expires_in:0},{expires_in:999999},{access_token:'x\n'},{refresh_token:''}]) assert.throws(()=>validateYouTubeToken(rawToken(patch)));
  const c=verifiedYouTubeChannel(rawChannel());assert.equal(c.url,'https://www.youtube.com/channel/'+channelId);assert.equal(c.scope,'readonly');
  for(const id of ['@name','UCshort','https://youtube.com/channel/'+channelId]) assert.throws(()=>verifiedYouTubeChannel(rawChannel(id)));
  for(const url of ['https://evil.invalid/x','http://yt3.ggpht.com/x','https://yt3.ggpht.com.evil.invalid/x','https://u@yt3.ggpht.com/x']) {const item=rawChannel();item.snippet.thumbnails.medium.url=url;assert.equal(verifiedYouTubeChannel(item).thumbnailUrl,'');}
});
test('unconfigured status is honest, start fails 503, authentication/manager/CSRF/origin checks cannot be bypassed',async()=>{
  const db=memoryDb();await withApp(db,async base=>{
    let r=await get(base,'status?workspaceId=w1');assert.equal(r.status,200);const s=await r.json();assert.equal(s.ready,false);assert.equal(s.connection,null);
    r=await post(base,'connect?service=yt',{workspaceId:'w1',policyVersion:POLICY_VERSION});assert.equal(r.status,503);assert.equal((await r.json()).error.code,'integration_not_configured');
    r=await fetch(base+'/api/oauth/google/status?workspaceId=w1');assert.equal(r.status,401);
  },{},{MANUS_JWT_SECRET:env.MANUS_JWT_SECRET,MANUS_PROJECT_ID:env.MANUS_PROJECT_ID});
  const p=provider(db);await withApp(db,async base=>{
    assert.equal((await get(base,'status?workspaceId=w1',sessionCookie('employee','e'),'employee')).status,403);
    assert.equal((await get(base,'status?workspaceId=other')).status,404);
    for(const path of ['connect?service=yt','confirm','cancel','disconnect']) {const body=path.startsWith('connect')?{workspaceId:'w1',policyVersion:POLICY_VERSION}:path==='confirm'?{workspaceId:'w1',channelId}:{workspaceId:'w1'};const r=await post(base,path,body,sessionCookie(),'u1',{'X-CSRF-Token':'forged'});assert.equal(r.status,403);}
    const r=await post(base,'connect?service=yt',{workspaceId:'w1',policyVersion:POLICY_VERSION},sessionCookie(),'u1',{Origin:'https://attacker.invalid'});assert.equal(r.status,403);
    assert.equal(p.calls.length,0);
  },{fetcher:p.fetcher});
});
test('start uses only dedicated Google OAuth endpoint/offline readonly/PKCE, binds encrypted attempt and does not expose PKCE',async()=>{
  const db=memoryDb();await withApp(db,async base=>{
    const s=await start(base);assert.equal(s.url.origin,'https://accounts.google.com');assert.equal(s.url.pathname,'/o/oauth2/v2/auth');assert.equal(s.url.searchParams.get('scope'),YOUTUBE_SCOPE);assert.equal(s.url.searchParams.get('access_type'),'offline');assert.equal(s.url.searchParams.get('prompt'),'select_account consent');assert.equal(s.url.searchParams.get('include_granted_scopes'),'false');assert.equal(s.url.searchParams.get('code_challenge_method'),'S256');assert.equal(s.url.searchParams.get('redirect_uri'),origin+'/api/oauth/google/callback');assert.equal(s.url.searchParams.has('client_secret'),false);assert.equal(s.url.searchParams.has('code_verifier'),false);
    const a=db.state.attempts[0];assert.equal(a.user_id,'u1');assert.equal(a.session_hash,digest(sessionTokens.u1.one));assert.equal(a.service,'yt');assert.equal(a.state_hash,digest(s.state));assert.equal(a.policy_version,POLICY_VERSION);assert.ok(!JSON.stringify(a).includes(s.state));assert.ok(s.cookie.includes(YOUTUBE_STATE_COOKIE));
    const status=await (await get(base,'status?workspaceId=w1')).json();assert.equal(status.pending,null);assert.ok(!JSON.stringify(status).includes(a.id));
  });
});
test('expired, replayed, wrong browser/session/user/workspace/service/policy attempts cannot exchange or commit',async()=>{
  for(const mutation of ['expired','session','user','browser','workspace','service','policy']) {
    const db=memoryDb(),p=provider(db);await withApp(db,async base=>{
      const s=await start(base);let cookie=s.cookie,user='u1';
      if(mutation==='expired')db.state.attempts[0].expires_at=new Date(0);
      if(mutation==='session')cookie=s.cookie.replace(sessionCookie(),sessionCookie('u1','other'));
      if(mutation==='user')user='u2';
      if(mutation==='browser')cookie=sessionCookie();
      if(mutation==='workspace')db.state.attempts[0].workspace_id='unknown';
      if(mutation==='service')db.state.attempts[0].service='gbp';
      if(mutation==='policy')db.state.attempts[0].policy_version='old';
      const r=await get(base,'callback?state='+s.state+'&code=OFFLINE_CODE',cookie,user);assert.match(r.headers.get('location'),/&youtube=failed#app$/);assert.equal(p.calls.length,0);assert.equal(db.state.connections.length,0);
    },{fetcher:p.fetcher});
  }
  const db=memoryDb(),p=provider(db);await withApp(db,async base=>{const s=await start(base);await callback(base,s);const count=p.calls.length;const r=await callback(base,s);assert.match(r.headers.get('location'),/&youtube=failed#app$/);assert.equal(p.calls.length,count);assert.equal(db.state.connections.length,1);},{fetcher:p.fetcher});
});
test('single-channel callback connects only after mine=true verification; no code/state/tokens survive public contract or redirect',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);assert.equal(p.calls.length,2);assert.equal(db.state.attempts.length,0);assert.equal(db.state.tokens.length,1);assert.ok(!db.state.tokens[0].token_cipher.includes('OFFLINE_'));
  const token=decryptYouTubeEnvelope(db.state.tokens[0].token_cipher,env,'w1',db.state.connections[0].id,'tokens');assert.equal(token.refreshToken,'OFFLINE_REFRESH_TOKEN');assert.equal(token.policyVersion,POLICY_VERSION);
  await withApp(db,async base=>{const r=await get(base,'status?workspaceId=w1');const s=await r.json();assert.equal(s.connection.status,'connected');assert.equal(s.connection.provider,'yt');assert.deepEqual(Object.keys(s.connection.details).sort(),['channelId','scope','thumbnailUrl','title','url','verifiedAt']);assert.ok(!JSON.stringify(s).includes('OFFLINE_'));assert.equal(s.pending,null);});
  assert.equal((await youtubeCapabilities(db,db.state.users[0],'w1',env)).read,true);
});
test('provider scope rejection, empty channels and missing offline refresh never create fake connections or expose provider errors',async()=>{
  for(const options of [{token:rawToken({scope:'openid'})},{channels:[]},{token:rawToken({refresh_token:undefined})}]) {
    const db=memoryDb(),p=provider(db,options);await withApp(db,async base=>{const s=await start(base);const r=await callback(base,s);assert.match(r.headers.get('location'),options.channels?/youtube=missing_channel/:/youtube=requires_reauth/);assert.ok(!r.headers.get('location').includes('OFFLINE'));assert.equal(db.state.connections.length,0);assert.equal(db.state.attempts.length,0);},{fetcher:p.fetcher});
  }
});
test('bounded channel pagination accepts verified candidates, never picks first; invalid confirmation and wrong-session/workspace are rejected',async()=>{
  const db=memoryDb(),p=provider(db,{pages:[{items:[rawChannel()],nextPageToken:'1'},{items:[rawChannel(otherId)]}]});await withApp(db,async base=>{
    const s=await start(base),r=await callback(base,s);assert.match(r.headers.get('location'),/youtube=choose/);assert.equal(db.state.connections.length,0);
    const status=await (await get(base,'status?workspaceId=w1')).json();assert.equal(status.pending.channels.length,2);assert.equal(status.pending.replacing,false);assert.ok(!JSON.stringify(status).includes('OFFLINE_'));
    assert.equal((await post(base,'confirm',{workspaceId:'w1',channelId:'UC'+'x'.repeat(22)})).status,409);
    assert.equal((await post(base,'confirm',{workspaceId:'w1',channelId},sessionCookie('u1','other'))).status,409);
    assert.equal((await get(base,'status?workspaceId=w1',sessionCookie('u1','other'))).status,200);assert.equal((await (await get(base,'status?workspaceId=w1',sessionCookie('u1','other'))).json()).pending,null);
    assert.equal((await post(base,'confirm',{workspaceId:'w2',channelId})).status,409);
    const confirm=await post(base,'confirm',{workspaceId:'w1',channelId:otherId});assert.equal(confirm.status,200);assert.equal((await confirm.json()).connection.details.channelId,otherId);
    assert.equal((await post(base,'confirm',{workspaceId:'w1',channelId:otherId})).status,409);
  },{fetcher:p.fetcher});
});
test('permissions, active subscription and quota union are rechecked at final commit, yt is not counted twice',async()=>{
  for(const change of ['employee','subscription','quota']) {
    const db=memoryDb(),p=provider(db,{channels:[rawChannel(),rawChannel(otherId)]});await withApp(db,async base=>{
      const s=await start(base);await callback(base,s);
      if(change==='employee')db.state.workspaces[0].members.u1='employee';
      if(change==='subscription')db.state.workspaces[0].subscription.status='cancelled';
      if(change==='quota'){db.state.workspaces[0].state_json.selected=['ig','tt'];db.state.connections.push({workspace_id:'w1',provider:'fb'});}
      const r=await post(base,'confirm',{workspaceId:'w1',channelId});assert.ok([403,409].includes(r.status));assert.equal(db.state.tokens.length,0);
    },{fetcher:p.fetcher});
  }
  const db=memoryDb(),p=provider(db);db.state.workspaces[0].plan.channels=1;await connect(db,p);assert.equal(db.state.connections.length,1);
});
test('replacing a different verified channel requires confirm; cancel preserves old grant/metadata and NEVER revokes',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);const old=structuredClone(db.state.tokens[0]);p.channels=[rawChannel(otherId)];await withApp(db,async base=>{
    const s=await start(base);assert.equal(s.url.searchParams.get('prompt'),'select_account');assert.match((await callback(base,s)).headers.get('location'),/youtube=choose/);
    const status=await (await get(base,'status?workspaceId=w1')).json();assert.equal(status.pending.replacing,true);assert.equal(status.connection.details.channelId,channelId);
    assert.equal((await post(base,'cancel',{workspaceId:'w1'})).status,200);assert.deepEqual(db.state.tokens[0],old);assert.equal(db.state.connections[0].public_json.channelId,channelId);assert.equal(db.state.attempts.length,0);assert.equal(p.calls.filter(c=>c.url.includes('revoke')).length,0);
    const next=await start(base);await callback(base,next);assert.equal((await post(base,'confirm',{workspaceId:'w1',channelId:otherId})).status,200);assert.equal(db.state.connections[0].public_json.channelId,otherId);assert.equal(db.state.tokens.length,1);assert.equal(p.calls.filter(c=>c.url.includes('revoke')).length,0);
  },{fetcher:p.fetcher});
});
test('missing refresh preserves only SAME channel after prior grant refresh+mine verification; different channel triggers explicit reconsent',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);p.token=rawToken({refresh_token:undefined});await withApp(db,async base=>{
    const s=await start(base);assert.match((await callback(base,s)).headers.get('location'),/youtube=connected/);assert.equal(db.state.connections[0].public_json.channelId,channelId);assert.ok(p.calls.some(c=>new URLSearchParams(c.opts.body).get('grant_type')==='refresh_token'));
    p.channels=[rawChannel(otherId)];const replace=await start(base);assert.match((await callback(base,replace)).headers.get('location'),/youtube=requires_reauth/);assert.equal(db.state.connections[0].public_json.channelId,channelId);assert.equal(db.state.tokens[0].reconsent_required,true);
    const consent=await start(base);assert.equal(consent.url.searchParams.get('prompt'),'select_account consent');
  },{fetcher:p.fetcher});
});
test('concurrent callback/final confirmation and superseded attempt cannot duplicate or overwrite connection',async()=>{
  const db=memoryDb(),p=provider(db,{channels:[rawChannel(),rawChannel(otherId)]});await withApp(db,async base=>{
    const abandoned=await start(base),s=await start(base);assert.match((await callback(base,abandoned)).headers.get('location'),/youtube=failed/);assert.equal(p.calls.length,0);
    const responses=await Promise.all([callback(base,s),callback(base,s)]);assert.equal(responses.filter(r=>r.headers.get('location').includes('youtube=choose')).length,1);assert.equal(p.calls.length,2);
    const confirms=await Promise.all([post(base,'confirm',{workspaceId:'w1',channelId}),post(base,'confirm',{workspaceId:'w1',channelId:otherId})]);assert.equal(confirms.filter(r=>r.status===200).length,1);assert.equal(db.state.tokens.length,1);assert.equal(db.state.connections.length,1);
  },{fetcher:p.fetcher});
});
test('maintenance refreshes/revalidates with durable lease and token version, not memory-only coordination',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);due(db);const before=db.state.tokens[0].token_version;
  const now=Date.now()+2*DAY;const counts=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>now});assert.equal(counts.checked,1);assert.equal(counts.refreshed,1);assert.equal(counts.revalidated,1);assert.equal(db.state.tokens[0].token_version,before+1);assert.equal(db.state.tokens[0].lease_owner,null);
  due(db);const races=await Promise.all([runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>now+DAY}),runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>now+DAY})]);assert.equal(races.reduce((n,c)=>n+c.revalidated,0),1);assert.ok(db.statements.some(s=>s.sql.includes('AND token_version=? AND (lease_until IS NULL')));
});
test('permanent invalid_grant deletes authorized tokens/metadata and allows secure reauthorization',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);due(db);p.tokenFailure={error:'invalid_grant'};
  const counts=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>Date.now()+DAY});assert.equal(counts.needsReauth,1);assert.equal(db.state.tokens[0].token_cipher,'');assert.deepEqual(db.state.connections[0].public_json,{});assert.equal(db.state.connections[0].status,'needs_reauth');assert.ok(!JSON.stringify(counts).includes('OFFLINE'));
  assert.equal(db.state.tokens[0].channel_id,'');assert.equal((await youtubeCapabilities(db,db.state.users[0],'w1',env)).read,false);p.tokenFailure=null;await withApp(db,async base=>{const s=await start(base);assert.equal(s.url.searchParams.get('prompt'),'select_account consent');assert.match((await callback(base,s)).headers.get('location'),/youtube=choose/);assert.equal((await post(base,'confirm',{workspaceId:'w1',channelId})).status,200);},{fetcher:p.fetcher});
});
test('transient provider outage retains usable metadata/grant until 30 days; stale public data hidden then purged',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);due(db);const old=db.state.tokens[0].token_cipher;p.tokenFailure={status:503,error:'SECRET_PROVIDER_ERROR'};
  let c=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>Date.now()+DAY});assert.equal(c.needsReauth,0);assert.equal(c.retried,1);assert.equal(db.state.tokens[0].token_cipher,old);assert.equal(db.state.connections[0].status,'connected');
  const now=Date.now()+31*DAY;await withApp(db,async base=>{const status=await (await get(base,'status?workspaceId=w1')).json();assert.equal(status.connection.status,'stale');assert.equal(status.connection.details,null);},{now:()=>now});
  c=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>now});assert.equal(c.metadataPurged,1);assert.equal(c.needsReauth,0);assert.deepEqual(db.state.connections[0].public_json,{});assert.equal(db.state.tokens[0].token_cipher,'');assert.equal(db.state.tokens[0].channel_id,'');
});
test('disconnect works for suspended workspace/inactive subscription, deletes local data before revoke and queues encrypted failures',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);p.revokeFailure=true;db.state.workspaces[0].status='suspended';db.state.workspaces[0].subscription.status='cancelled';
  await withApp(db,async base=>{const r=await post(base,'disconnect',{workspaceId:'w1'});assert.equal(r.status,200);const result=await r.json();assert.equal(result.revocation,'pending');assert.equal(result.sharedGrantWarning,true);assert.equal(db.state.tokens.length,0);assert.equal(db.state.connections.length,0);assert.equal(db.state.attempts.length,0);assert.equal(db.state.revocations.length,1);assert.ok(!db.state.revocations[0].token_cipher.includes('OFFLINE_'));assert.ok(db.state.revocations[0].expires_at-db.state.revocations[0].requested_at<=7*DAY);const status=await (await get(base,'status?workspaceId=w1')).json();assert.equal(status.reason,'revocation_pending');},{fetcher:p.fetcher});
  p.revokeFailure=false;const c=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher});assert.equal(c.revoked,1);assert.equal(db.state.revocations.length,0);
});
test('disconnect with broken crypto key still purges local metadata and honestly reports unavailable revocation',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);await withApp(db,async base=>{const r=await post(base,'disconnect',{workspaceId:'w1'});assert.equal(r.status,200);assert.equal((await r.json()).revocation,'unavailable');assert.equal(db.state.tokens.length,0);assert.equal(db.state.connections.length,0);},{fetcher:p.fetcher},{...env,TASWIQAT_YOUTUBE_TOKEN_KEY:undefined});
});
test('maintenance cleanup is bounded, expired attempts and seven-day revocations are locally deleted even when disabled',async()=>{
  const db=memoryDb(),p=provider(db);await withApp(db,async base=>{await start(base);});const now=Date.now()+11*60000;
  for(let i=0;i<3;i++)db.state.revocations.push({id:'r'+i,workspace_id:'w1',token_cipher:'OFFLINE_ENCRYPTED',requested_at:new Date(now-8*DAY),expires_at:new Date(now-1),next_attempt_at:new Date(now-1),lease_until:null});
  const c=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>now,batchSize:2});assert.equal(c.attemptsExpired,1);assert.equal(c.revocationExpired,2);assert.equal(db.state.revocations.length,1);assert.equal(p.calls.length,0);
  const disabled=await runYouTubeMaintenance(db,{}, {fetcher:p.fetcher,now:()=>now});assert.equal(disabled.disabled,true);assert.equal(disabled.revocationExpired,1);assert.equal(db.state.revocations.length,0);assert.equal(p.calls.length,0);
  db.state.schema=3;assert.equal((await runYouTubeMaintenance(db,env)).disabled,true);
});

test('production start/status require valid public CMS support email, never private admin email; operator readiness exposes metadata only',async()=>{
  const production={...env,TASWIQAT_YOUTUBE_MODE:'production',TASWIQAT_YOUTUBE_PRODUCTION_APPROVED:'true',TASWIQAT_YOUTUBE_MAINTENANCE_READY:'true'};
  const summary=youtubeReadiness(production);assert.equal(summary.ready,true);assert.equal(summary.policyVersion,POLICY_VERSION);assert.deepEqual(Object.keys(summary).sort(),['mode','origin','policyVersion','ready','reason']);assert.ok(!JSON.stringify(summary).includes('OFFLINE'));
  const db=memoryDb(),p=provider(db);await withApp(db,async base=>{
    for(const contactEmail of [undefined,'','not an email']) {
      db.state.publicSite={contactEmail};const r=await post(base,'connect?service=yt',{workspaceId:'w1',policyVersion:POLICY_VERSION});assert.equal(r.status,503);assert.equal((await r.json()).error.code,'integration_not_configured');
      const status=await (await get(base,'status?workspaceId=w1')).json();assert.equal(status.ready,false);assert.equal(status.reason,'public_support_not_configured');assert.deepEqual(Object.keys(status).sort(),['connection','mode','pending','policyVersion','ready','reason']);
    }
    assert.equal(p.calls.length,0);db.state.publicSite={contactEmail:'support@example.invalid'};const s=await start(base);assert.match((await callback(base,s)).headers.get('location'),/youtube=connected/);
    assert.ok(!db.statements.some(s=>s.sql.includes('private_admin')));
  },{fetcher:p.fetcher},production);
});
test('capability fails closed for swapped cipher/key, revoked authorizer and inactive subscription',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);
  let c=await youtubeCapabilities(db,db.state.users[0],'w1',{...env,TASWIQAT_YOUTUBE_TOKEN_KEY:randomBytes(32).toString('base64')});assert.equal(c.read,false);assert.equal(c.reason,'integration_data_unavailable');
  db.state.workspaces[0].members.u1='employee';c=await youtubeCapabilities(db,db.state.users[1],'w1',env);assert.equal(c.read,false);assert.equal(c.reason,'manager_required');db.state.workspaces[0].members.u1='owner';
  db.state.workspaces[0].subscription.status='cancelled';c=await youtubeCapabilities(db,db.state.users[0],'w1',env);assert.equal(c.read,false);assert.equal(c.reason,'subscription_inactive');
});
test('Google access_denied consumes attempt without revoking or changing old connection',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);const old=structuredClone(db.state.tokens[0]);await withApp(db,async base=>{
    const s=await start(base),r=await get(base,'callback?state='+s.state+'&error=access_denied',s.cookie);assert.equal(r.headers.get('location'),origin+'/?workspace=w1&youtube=cancelled#app');assert.deepEqual(db.state.tokens[0],old);assert.equal(db.state.attempts.length,0);assert.equal(p.calls.filter(c=>c.url.includes('revoke')).length,0);
  },{fetcher:p.fetcher});
});
test('pending TTL and cancel during provider exchange prevent delayed commit, preserving previous connection',async()=>{
  const db=memoryDb(),p=provider(db,{channels:[rawChannel(),rawChannel(otherId)]});await withApp(db,async base=>{
    const s=await start(base);await callback(base,s);db.state.attempts[0].expires_at=new Date(0);assert.equal((await post(base,'confirm',{workspaceId:'w1',channelId})).status,409);assert.equal(db.state.tokens.length,0);assert.equal((await (await get(base,'status?workspaceId=w1')).json()).pending,null);
  },{fetcher:p.fetcher});
  const db2=memoryDb(),p2=provider(db2);let release,entered;const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
  const fetcher=async(url,options)=>{if(url==='https://oauth2.googleapis.com/token'){entered();await gate;}return p2.fetcher(url,options);};
  await withApp(db2,async base=>{const s=await start(base);const waiting=callback(base,s);await entry;assert.equal((await post(base,'cancel',{workspaceId:'w1'})).status,200);release();assert.match((await waiting).headers.get('location'),/youtube=failed/);assert.equal(db2.state.tokens.length,0);assert.equal(db2.state.connections.length,0);},{fetcher});
});

test('missing-refresh fallback holds a durable lease across Google calls and persists a rotating prior grant safely',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);p.token=rawToken({refresh_token:undefined});p.refresh=rawToken({access_token:'OFFLINE_ROTATED_ACCESS',refresh_token:'OFFLINE_ROTATED_REFRESH'});
  let entered,release;const entry=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const fetcher=async(url,options)=>{if(url==='https://oauth2.googleapis.com/token' && new URLSearchParams(options.body).get('grant_type')==='refresh_token'){assert.ok(db.state.tokens[0].lease_owner);entered();await gate;}return p.fetcher(url,options);};
  await withApp(db,async base=>{
    const s=await start(base);const waiting=callback(base,s);await entry;due(db);
    const counts=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher});assert.equal(counts.checked,0);assert.equal(db.state.tokens[0].lease_owner!==null,true);
    release();assert.match((await waiting).headers.get('location'),/youtube=connected/);
    const row=db.state.tokens[0],tokens=decryptYouTubeEnvelope(row.token_cipher,env,'w1',row.connection_id,'tokens');assert.equal(tokens.refreshToken,'OFFLINE_ROTATED_REFRESH');assert.equal(row.lease_owner,null);assert.equal(row.token_version,3);
  },{fetcher});
});
test('pending revocation blocks new handshake rather than letting old-grant retry silently invalidate a replacement',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);p.revokeFailure=true;await withApp(db,async base=>{
    assert.equal((await post(base,'disconnect',{workspaceId:'w1'})).status,200);const before=p.calls.length;
    const r=await post(base,'connect?service=yt',{workspaceId:'w1',policyVersion:POLICY_VERSION});assert.equal(r.status,409);assert.equal((await r.json()).error.code,'revocation_pending');assert.equal(p.calls.length,before);assert.equal(db.state.attempts.length,0);
  },{fetcher:p.fetcher});
});
test('malformed/transient refresh response never falsely claims Google revocation, while genuine 401 authorization loss purges immediately',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);due(db);p.refresh=rawToken({expires_in:0});const c=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>Date.now()+DAY});assert.equal(c.retried,1);assert.equal(c.needsReauth,0);assert.equal(db.state.connections[0].status,'connected');assert.ok(db.state.tokens[0].token_cipher);
  p.refresh=rawToken();p.channelFailure={status:401,error:'SECRET_PROVIDER_ERROR'};due(db);const invalid=await runYouTubeMaintenance(db,env,{fetcher:p.fetcher,now:()=>Date.now()+DAY});assert.equal(invalid.needsReauth,1);assert.equal(db.state.tokens[0].channel_id,'');assert.equal(db.state.tokens[0].token_cipher,'');
});

for (const phase of ['exchange','verify']) test(`logout during Google ${phase} returns 200/status 401 and cannot retain callback tokens or connection`,async()=>{
  const db=memoryDb(),p=provider(db);
  let entered,release;const entry=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const fetcher=async(url,options)=>{
    if (phase==='exchange'?url==='https://oauth2.googleapis.com/token':url.startsWith('https://www.googleapis.com/youtube/v3/channels?')) {entered();await gate;}
    return p.fetcher(url,options);
  };
  await withApp(db,async base=>{
    const s=await start(base),waiting=callback(base,s);await entry;
    try {
      const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:headers()});assert.equal(logout.status,200);
      assert.equal((await get(base,'status?workspaceId=w1')).status,401);
      assert.equal(db.state.attempts.length,0);assert.equal(db.state.sessionRevocations.length,1);
    } finally {release();}
    assert.match((await waiting).headers.get('location'),/youtube=failed#app$/);
    assert.equal(db.state.attempts.length,0);assert.equal(db.state.tokens.length,0);assert.equal(db.state.connections.length,0);
    assert.equal(p.calls.length,phase==='exchange'?1:2);
  },{fetcher});
});

for (const change of ['expiry','session_version','admin_pin']) test(`${change} changing during Google verification rejects cached request auth without retaining tokens`,async t=>{
  const db=memoryDb(),p=provider(db);const originalNow=Date.now(),expiry=Math.floor(originalNow/1000)+60;
  const cookie=change==='expiry'?`${SESSION_COOKIE}=${await signedSession('u1','short-lived',expiry)}`:sessionCookie();
  if (change==='admin_pin') {db.state.users[0].role='admin';db.state.adminPin=db.state.users[0].open_id;}
  let entered,release;const entry=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const fetcher=async(url,options)=>{if (url.startsWith('https://www.googleapis.com/youtube/v3/channels?')) {entered();await gate;}return p.fetcher(url,options);};
  await withApp(db,async base=>{
    const s=await start(base,'w1',cookie),waiting=callback(base,s);await entry;
    try {
      if (change==='expiry') t.mock.method(Date,'now',()=>expiry*1000);
      else await db.transaction(async()=>{if (change==='session_version') db.state.users[0].session_version++;else db.state.adminPin='offline:someone-else';});
      assert.equal((await get(base,'status?workspaceId=w1',cookie)).status,change==='admin_pin'?403:401);
      // This mutation deliberately does not delete the attempt: auth must fail independently.
      assert.equal(db.state.attempts.length,1);
    } finally {release();}
    assert.match((await waiting).headers.get('location'),/youtube=failed#app$/);
    assert.equal(db.state.attempts.length,0);assert.equal(db.state.tokens.length,0);assert.equal(db.state.connections.length,0);
  },{fetcher,now:()=>originalNow});
});

for (const phase of ['stage','commit']) test(`session version is rechecked inside the canonical ${phase} transaction after the provider-side check`,async()=>{
  const db=memoryDb(),p=provider(db);
  await withApp(db,async base=>{
    const s=await start(base),transaction=db.transaction.bind(db);let saves=0;
    db.transaction=(fn,options={})=>transaction(async tx=>{
      if (options.mutation!==false && ++saves===(phase==='stage'?1:2)) db.state.users[0].session_version++;
      return fn(tx);
    },options);
    assert.match((await callback(base,s)).headers.get('location'),/youtube=failed#app$/);
    assert.equal(saves,phase==='stage'?1:2);assert.equal(p.calls.length,2);
    assert.equal(db.state.attempts.length,0);assert.equal(db.state.tokens.length,0);assert.equal(db.state.connections.length,0);
  },{fetcher:p.fetcher});
});

for (const phase of ['refresh','verify']) test(`logout during prior-grant ${phase} never adopts a rotated ciphertext from an invalid session`,async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);const old=structuredClone(db.state.tokens[0]),connection=structuredClone(db.state.connections[0]);
  p.token=rawToken({refresh_token:undefined});p.refresh=rawToken({access_token:'OFFLINE_ROTATED_ACCESS',refresh_token:'OFFLINE_ROTATED_REFRESH'});
  let entered,release,verifications=0;const entry=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const fetcher=async(url,options)=>{
    const refreshing=url==='https://oauth2.googleapis.com/token' && new URLSearchParams(options.body).get('grant_type')==='refresh_token';
    const verifying=url.startsWith('https://www.googleapis.com/youtube/v3/channels?') && ++verifications===2;
    if (phase==='refresh'?refreshing:verifying) {entered();await gate;}
    return p.fetcher(url,options);
  };
  await withApp(db,async base=>{
    const s=await start(base),waiting=callback(base,s);await entry;
    try {assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers:headers()})).status,200);assert.equal((await get(base,'status?workspaceId=w1')).status,401);}finally{release();}
    assert.match((await waiting).headers.get('location'),/youtube=failed#app$/);
    assert.equal(db.state.tokens[0].token_cipher,old.token_cipher);assert.equal(db.state.tokens[0].token_version,old.token_version);
    assert.equal(db.state.tokens[0].lease_owner,null);assert.deepEqual(db.state.connections[0],connection);assert.equal(db.state.attempts.length,0);
  },{fetcher});
});

test('prior-grant adoption rechecks the session under its final canonical lease/version save lock',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);const old=structuredClone(db.state.tokens[0]);p.token=rawToken({refresh_token:undefined});p.refresh=rawToken({refresh_token:'OFFLINE_ROTATED_REFRESH'});
  await withApp(db,async base=>{
    const s=await start(base),transaction=db.transaction.bind(db);let saves=0;
    db.transaction=(fn,options={})=>transaction(async tx=>{if (options.mutation!==false && ++saves===1) db.state.users[0].session_version++;return fn(tx);},options);
    assert.match((await callback(base,s)).headers.get('location'),/youtube=failed#app$/);
    assert.equal(p.calls.length,6);assert.equal(db.state.tokens[0].token_cipher,old.token_cipher);assert.equal(db.state.tokens[0].token_version,old.token_version);
    assert.equal(db.state.tokens[0].lease_owner,null);assert.equal(db.state.attempts.length,0);
  },{fetcher:p.fetcher});
});

for (const mode of ['disabled','key_missing','production_without_public_support']) test(`local 7/30-day cleanup runs with ${mode}, is bounded, retains markers and makes zero provider calls`,async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);await withApp(db,async base=>{await start(base,'w2');});
  const now=Date.now()+31*DAY;
  db.state.tokens[0].verified_at=new Date(now-30*DAY);db.state.tokens[0].next_check_at=new Date(now+DAY);db.state.tokens[0].token_cipher='OFFLINE_UNDECRYPTABLE_CIPHERTEXT';
  for (let i=0;i<3;i++) db.state.revocations.push({id:'expired'+i,workspace_id:'w1',token_cipher:'OFFLINE_UNDECRYPTABLE_CIPHERTEXT',requested_at:new Date(now-7*DAY),expires_at:new Date(now+DAY),next_attempt_at:new Date(now+DAY),lease_until:null});
  db.state.revocations.push({id:'fresh',workspace_id:'w1',token_cipher:'OFFLINE_UNDECRYPTABLE_CIPHERTEXT',requested_at:new Date(now-DAY),expires_at:new Date(now+6*DAY),next_attempt_at:new Date(now-1),lease_until:null});
  const customEnv=mode==='disabled'?{...env,TASWIQAT_YOUTUBE_MODE:'disabled'}:mode==='key_missing'?{...env,TASWIQAT_YOUTUBE_TOKEN_KEY:undefined}:{...env,TASWIQAT_YOUTUBE_MODE:'production',TASWIQAT_YOUTUBE_PRODUCTION_APPROVED:'true',TASWIQAT_YOUTUBE_MAINTENANCE_READY:'true'};
  const calls=p.calls.length,version=db.state.tokens[0].token_version;
  const c=await runYouTubeMaintenance(db,customEnv,{fetcher:p.fetcher,now:()=>now,batchSize:2});
  assert.equal(c.disabled,true);assert.equal(c.attemptsExpired,1);assert.equal(c.revocationExpired,2);assert.equal(c.metadataPurged,1);assert.equal(c.checked,0);assert.equal(c.revalidated,0);assert.equal(c.refreshed,0);assert.equal(c.revoked,0);assert.equal(c.failed,0);assert.ok(!('lastSuccess' in c));
  assert.equal(db.state.revocations.length,2);assert.equal(db.state.tokens[0].token_cipher,'');assert.equal(db.state.tokens[0].channel_id,'');assert.equal(db.state.tokens[0].token_version,version+1);assert.equal(db.state.tokens[0].lease_owner,null);
  assert.equal(db.state.connections.length,1);assert.equal(db.state.connections[0].status,'stale');assert.deepEqual(db.state.connections[0].public_json,{});assert.equal(p.calls.length,calls);
  const again=await runYouTubeMaintenance(db,customEnv,{fetcher:p.fetcher,now:()=>now,batchSize:2});assert.equal(again.disabled,true);assert.equal(again.metadataPurged,0);assert.equal(again.revocationExpired,1);assert.deepEqual(db.state.revocations.map(r=>r.id),['fresh']);assert.equal(p.calls.length,calls);
});

test('disabled local retention respects live leases and uses bounded version-checked canonical saves',async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);const now=Date.now()+31*DAY,old=structuredClone(db.state.tokens[0]);
  for (let i=0;i<3;i++) {
    const workspace_id='cleanup'+i,connection_id='connection'+i;
    db.state.tokens.push({...old,workspace_id,connection_id,verified_at:new Date(now-30*DAY),next_check_at:new Date(now+DAY),lease_owner:i===2?'busy':null,lease_until:i===2?new Date(now+60000):null});
    db.state.connections.push({...db.state.connections[0],id:connection_id,workspace_id});
  }
  db.state.tokens[0].verified_at=new Date(now-29*DAY); // Fresh metadata must not be removed.
  db.state.revocations.push({id:'busy-revocation',workspace_id:'w1',token_cipher:'OFFLINE_CIPHER',requested_at:new Date(now-8*DAY),expires_at:new Date(now-1),next_attempt_at:new Date(now-1),lease_owner:'busy',lease_until:new Date(now+60000)});
  const calls=p.calls.length,customEnv={...env,TASWIQAT_YOUTUBE_MODE:'disabled'};
  const races=await Promise.all([runYouTubeMaintenance(db,customEnv,{fetcher:p.fetcher,now:()=>now,batchSize:1}),runYouTubeMaintenance(db,customEnv,{fetcher:p.fetcher,now:()=>now,batchSize:1})]);
  assert.equal(races.reduce((n,c)=>n+c.metadataPurged,0),1);assert.equal(races.reduce((n,c)=>n+c.skipped,0),1);
  const nextBatch=await runYouTubeMaintenance(db,customEnv,{fetcher:p.fetcher,now:()=>now,batchSize:1});assert.equal(nextBatch.metadataPurged,1);
  assert.equal(db.state.tokens[0].token_cipher,old.token_cipher);assert.equal(db.state.tokens[3].token_cipher,old.token_cipher);assert.equal(db.state.revocations.length,1);
  const leaseEnded=await runYouTubeMaintenance(db,customEnv,{fetcher:p.fetcher,now:()=>now+60000,batchSize:1});assert.equal(leaseEnded.metadataPurged,1);assert.equal(leaseEnded.revocationExpired,1);assert.equal(db.state.revocations.length,0);assert.equal(p.calls.length,calls);
  assert.ok(db.statements.some(s=>s.sql.includes('AND token_version=? AND (lease_until IS NULL')));
  for (const statement of db.statements.filter(s=>s.sql.includes("SET channel_id=''"))) assert.equal(statement.args[0],'');
});

for (const change of ['version','lease_owner']) test(`disabled retention cannot purge a token whose ${change} changes before final save`,async()=>{
  const db=memoryDb(),p=provider(db);await connect(db,p);const now=Date.now()+31*DAY,old=structuredClone(db.state.tokens[0]),calls=p.calls.length;
  db.state.tokens[0].next_check_at=new Date(now+DAY);
  if (change==='version') {
    const query=db.query.bind(db);let changed=false;
    db.query=async(sql,args=[])=>{
      if (!changed && sql.startsWith('UPDATE taswiqat_youtube_tokens SET lease_owner=')) {changed=true;db.state.tokens[0].token_version++;db.state.tokens[0].verified_at=new Date(now);}
      return query(sql,args);
    };
  } else {
    const transaction=db.transaction.bind(db);let changed=false;
    db.transaction=(fn,options={})=>transaction(async tx=>{if (!changed) {changed=true;db.state.tokens[0].lease_owner='new-owner';}return fn(tx);},options);
  }
  const c=await runYouTubeMaintenance(db,{...env,TASWIQAT_YOUTUBE_MODE:'disabled'},{fetcher:p.fetcher,now:()=>now});
  assert.equal(c.disabled,true);assert.equal(c.metadataPurged,0);assert.equal(c.skipped,1);assert.equal(c.failed,0);
  assert.equal(db.state.tokens[0].token_cipher,old.token_cipher);assert.equal(db.state.tokens[0].channel_id,channelId);assert.equal(db.state.connections[0].status,'connected');assert.equal(p.calls.length,calls);
});

const maintenanceQueries=db=>db.statements.filter(s=>s.sql.startsWith('SELECT') && /ORDER BY .* LIMIT /.test(s.sql));
const batchCases=[['one',1,1],['five',5,5],['hundred',100,100],['zero',0,1],['negative',-8,1],['over maximum',101,100],['huge integer',Number.MAX_VALUE,100],['NaN',NaN,25],['fraction',5.5,25],['numeric string','5',25],['SQL-shaped string','5; DELETE FROM taswiqat_youtube_tokens',25],['infinity',Infinity,25],['undefined',undefined,25],['null',null,25],['boolean',true,25],['object',{},25],['array',[5],25]];
for (const [label,batchSize,expected] of batchCases) test(`maintenance SQL LIMIT preserves integer-only normalization for ${label}`,async()=>{
  const db=memoryDb(),p=provider(db),now=Date.now();
  const counts=await runYouTubeMaintenance(db,env,{batchSize,now:()=>now,fetcher:p.fetcher});
  assert.equal(counts.disabled,false);assert.equal(counts.failed,0);assert.equal(p.calls.length,0);
  const queries=maintenanceQueries(db);assert.equal(queries.length,5);
  assert.deepEqual(queries.map(s=>sqlLimit(s.sql)),Array(5).fill(expected));
  assert.deepEqual(queries.map(s=>s.args.length),[1,3,2,4,2]);
  const at=new Date(now),weekAgo=new Date(now-7*DAY),monthAgo=new Date(now-30*DAY);
  assert.deepEqual(queries.map(s=>s.args),[[at],[at,weekAgo,at],[monthAgo,at],[at,at,weekAgo,at],[at,at]]);
  for (const s of queries) assert.equal((s.sql.match(/\?/g)||[]).length,s.args.length);
  assert.ok(db.statements.every(s=>s.sql.startsWith('SELECT')));
});

test('empty disabled maintenance returns failed zero, reads only and never calls the provider',async()=>{
  const db=memoryDb(),p=provider(db);
  const counts=await runYouTubeMaintenance(db,{}, {batchSize:5,fetcher:p.fetcher});
  assert.equal(counts.disabled,true);assert.equal(counts.failed,0);assert.equal(p.calls.length,0);
  assert.ok(Object.entries(counts).filter(([key])=>key!=='disabled').every(([,value])=>value===0));
  assert.deepEqual(maintenanceQueries(db).map(s=>sqlLimit(s.sql)),[5,5,5]);
  assert.ok(db.statements.every(s=>s.sql.startsWith('SELECT')));
});

for (const [label,batch,expired,retained,limits] of [['remaining',5,2,1,[5,5,5,3,4]],['exhausted',1,1,1,[1,1,1]]]) test(`maintenance embeds only positive ${label} budgets after local cleanup`,async()=>{
  const db=memoryDb(),p=provider(db),now=Date.now();
  for(let i=0;i<expired;i++) db.state.revocations.push({id:'expired-'+i,workspace_id:'w1',token_cipher:'OFFLINE_UNDECRYPTABLE',requested_at:new Date(now-8*DAY),expires_at:new Date(now-1),next_attempt_at:new Date(now-1),lease_until:null});
  for(let i=0;i<retained;i++) {
    const workspace_id='retained-'+i,connection_id='connection-'+i;
    db.state.tokens.push({workspace_id,connection_id,user_id:'u1',channel_id:channelId,token_cipher:'OFFLINE_UNDECRYPTABLE',verified_at:new Date(now-31*DAY),next_check_at:new Date(now+DAY),token_version:1,retry_count:0,lease_owner:null,lease_until:null});
    db.state.connections.push({id:connection_id,workspace_id,provider:'yt',status:'connected',public_json:{}});
  }
  const counts=await runYouTubeMaintenance(db,env,{batchSize:batch,now:()=>now,fetcher:p.fetcher});
  assert.equal(counts.disabled,false);assert.equal(counts.failed,0);assert.equal(counts.revocationExpired,expired);assert.equal(counts.metadataPurged,retained);assert.equal(p.calls.length,0);
  const queries=maintenanceQueries(db);assert.deepEqual(queries.map(s=>sqlLimit(s.sql)),limits);
  for (const s of queries) assert.equal((s.sql.match(/\?/g)||[]).length,s.args.length);
  assert.ok(!db.statements.some(s=>/LIMIT (?:\?|0)\b/.test(s.sql)));
});

test('registered disabled empty-engine callback returns 200 without advancing last_success_at',async()=>{
  const db=memoryDb(),p=provider(db),query=db.query.bind(db),previous=new Date('2026-11-01T00:00:00Z');let lastSuccess=previous;
  db.query=async(sql,args=[])=>{
    if (!sql.includes('taswiqat_channel_maintenance')) return query(sql,args);
    db.statements.push({sql,args});
    if (sql.startsWith('SELECT')) return [{task_uid:'offline-task',last_success_at:lastSuccess}];
    assert.ok(sql.startsWith('UPDATE'));
    if (sql.includes('last_success_at=CASE') && args[2]===true) lastSuccess=new Date();
    return {affectedRows:1};
  };
  const app=express();app.use(cookieParser());app.use(express.json());
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  mountChannelMaintenance(app,db,{...env,TASWIQAT_YOUTUBE_MODE:'disabled'},wrap,runYouTubeMaintenance,{identity:async()=>({taskUid:'offline-task',projectId:env.MANUS_PROJECT_ID,openId:'cron_offline'}),youtube:{batchSize:5,fetcher:p.fetcher}});
  app.use((e,req,res,next)=>res.status(e.status||500).json({error:{code:e.code||'failed'}}));
  const ticket=await new SignJWT({appId:env.MANUS_PROJECT_ID,openId:'cron_offline'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(env.MANUS_JWT_SECRET));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/scheduled/youtube-maintenance`,{method:'POST',headers:{Cookie:`app_session_id=${ticket}`,'Content-Type':'application/json'},body:JSON.stringify({workspaceId:'ignored'})});
    assert.equal(response.status,200);const data=await response.json();assert.equal(data.ok,true);assert.equal(data.disabled,true);assert.equal(data.failed,0);assert.equal(p.calls.length,0);
    const update=db.statements.find(s=>s.sql.includes('last_success_at=CASE'));assert.ok(update);
    assert.equal(update.args[0],'disabled');assert.equal(update.args[2],false);assert.match(update.sql,/ELSE last_success_at END/);assert.equal(lastSuccess,previous);
    assert.deepEqual(maintenanceQueries(db).map(s=>sqlLimit(s.sql)),[5,5,5]);
    assert.ok(db.statements.filter(s=>!s.sql.startsWith('SELECT')).every(s=>s.sql.startsWith('UPDATE taswiqat_channel_maintenance')));
  } finally {await new Promise(resolve=>server.close(resolve));}
});
