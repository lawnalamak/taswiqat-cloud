import { createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError, fail, parse, idSchema, emailSchema, digest, CHANNEL_IDS } from './validation.mjs';
import { json, assertActiveUser } from './db.mjs';
import { getWorkspace, limitsFor } from './workspaces.mjs';
import { DEFAULT_AUTH_ORIGIN, allowedAuthOrigin, checkCsrf, validateOrigin, assertCurrentSession } from './auth.mjs';
import { YOUTUBE_TABLE_NAMES } from './youtube-schema.mjs';

/** Public integration contract (mount before the reserved /api/oauth fallback):
 * mountYouTubeRoutes(app, db, env, wrap, authenticate, services={fetcher,now})
 * youtubeCapabilities(db,user,workspaceId,env) -> {ready,reason,mode,connection,read}
 * runYouTubeMaintenance(db,env,services={fetcher,now,batchSize}) -> safe counts only.
 * youtubeReadiness(env) -> env-only {ready,reason,mode,origin,policyVersion};
 * live status/start additionally require v4 schema and public CMS support email in production.
 * GET status -> {ready,reason,mode,policyVersion,connection,pending}.
 * connection: {id,provider:'yt',status,details:{channelId,title,thumbnailUrl,url,verifiedAt,scope:'readonly'}}.
 * Cleared metadata uses details:null; pending is null or {channels:[details],replacing:boolean}.
 * POST connect?service=yt {workspaceId,policyVersion} -> {url}.
 * POST confirm {workspaceId,channelId} -> {ok:true,connection}; cancel -> {ok:true}.
 * POST disconnect -> {ok:true,revocation:'completed'|'pending'|'unavailable'|'not_needed',sharedGrantWarning:true}.
 * No publish capability. Google OAuth account-login settings are deliberately unrelated.
 * Dedicated Google OAuth app is recommended: revoking one token can revoke a shared grant.
 * Cancel/replacement NEVER revoke tokens. No provider requests are made during domain transactions.
 */
export const POLICY_VERSION = '2026-11-17';
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_STATE_COOKIE = 'taswiqat_youtube_state';
const DAY = 86400000;
const ATTEMPT_TTL = 10 * 60000;
const PENDING_TTL = 5 * 60000;
const LEASE_TTL = 180000;
const MAX_CHANNELS = 100;
const MAX_PAGES = 5;
const CHANNEL_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const baseBody = z.object({ workspaceId:idSchema }).strict();
const connectBody = z.object({ workspaceId:idSchema, policyVersion:z.literal(POLICY_VERSION) }).strict();
const confirmBody = z.object({ workspaceId:idSchema, channelId:z.string().regex(CHANNEL_PATTERN) }).strict();
const cookieOptions = { httpOnly:true, secure:true, sameSite:'lax', path:'/api/oauth/google' };
const nowOf = services => {
  const n = services.now ? services.now() : Date.now();
  if (!Number.isSafeInteger(n) || n < 0) fail(503,'integration_unavailable','تكامل YouTube غير متاح مؤقتًا');
  return n;
};
const date = n => new Date(n);
const millis = v => v instanceof Date ? v.getTime() : new Date(v).getTime();
const safeEqual = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const unavailable = () => new ApiError(503,'integration_unavailable','تكامل YouTube غير متاح مؤقتًا');
const configError = () => fail(503,'integration_not_configured','ربط YouTube غير مهيأ حاليًا');

function tokenKey(env) {
  const value = env.TASWIQAT_YOUTUBE_TOKEN_KEY;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) configError();
  const key=Buffer.from(value,'base64');
  if (key.length!==32 || key.toString('base64')!==value) configError();
  return key;
}
/** Safe configuration summary only: never returns any key or credential. */
export function youtubeConfiguration(env={},userId) {
  const mode = ['disabled','testing','production'].includes(env.TASWIQAT_YOUTUBE_MODE) ? env.TASWIQAT_YOUTUBE_MODE : 'disabled';
  let origin=DEFAULT_AUTH_ORIGIN;
  try {
    const raw=env.TASWIQAT_YOUTUBE_ORIGIN || DEFAULT_AUTH_ORIGIN;
    origin=validateOrigin(raw,{});
    if (origin!==raw) throw new Error();
    allowedAuthOrigin(origin,env);
    tokenKey(env);
    for (const key of ['TASWIQAT_YOUTUBE_CLIENT_ID','TASWIQAT_YOUTUBE_CLIENT_SECRET']) {
      if (typeof env[key]!=='string' || !env[key].trim() || env[key].length>2048 || /[\r\n\0]/.test(env[key])) throw new Error();
    }
  } catch { return {ready:false,reason:'integration_not_configured',mode,origin:DEFAULT_AUTH_ORIGIN}; }
  if (mode==='disabled') return {ready:false,reason:'integration_disabled',mode,origin};
  if (mode==='production' && (env.TASWIQAT_YOUTUBE_PRODUCTION_APPROVED!=='true' || env.TASWIQAT_YOUTUBE_MAINTENANCE_READY!=='true')) return {ready:false,reason:'production_not_approved',mode,origin};
  if (mode==='testing') {
    const ids=(env.TASWIQAT_YOUTUBE_TEST_USER_IDS || '').split(',').map(x=>x.trim()).filter(Boolean);
    if (!ids.length || ids.some(x=>!idSchema.safeParse(x).success)) return {ready:false,reason:'integration_not_configured',mode,origin};
    if (userId!==undefined && !ids.includes(userId)) return {ready:false,reason:'testing_user_not_allowed',mode,origin};
  }
  return {ready:true,reason:null,mode,origin};
}
/** Environment readiness only. No DB access and no secret/support-email values. */
export function youtubeReadiness(env={}) {
  return {...youtubeConfiguration(env),policyVersion:POLICY_VERSION};
}
async function configurationForDb(db,env,userId) {
  const c=youtubeConfiguration(env,userId);
  if (c.ready && c.mode==='production') {
    try {
      const rows=await db.query('SELECT site_json FROM taswiqat_site_settings WHERE id=1');
      const publicSite=json(rows[0]?.site_json);
      if (!emailSchema.safeParse(publicSite?.contactEmail).success) return {...c,ready:false,reason:'public_support_not_configured'};
    } catch {return {...c,ready:false,reason:'public_support_not_configured'};}
  }
  return c;
}
async function configuredDb(db,env,userId) {
  const c=await configurationForDb(db,env,userId);
  if (!c.ready) configError();
  return c;
}
function aad(workspaceId,recordId,purpose) {
  if (!idSchema.safeParse(workspaceId).success || !idSchema.safeParse(recordId).success || !['attempt','pending','tokens','revocation'].includes(purpose)) throw unavailable();
  return Buffer.from(JSON.stringify(['taswiqat:youtube:v1',workspaceId,recordId,purpose]));
}
export function encryptYouTubeEnvelope(value,env,workspaceId,recordId,purpose) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',tokenKey(env),iv);
  cipher.setAAD(aad(workspaceId,recordId,purpose));
  const plaintext=JSON.stringify(value);
  if (typeof plaintext!=='string' || Buffer.byteLength(plaintext)>100000) throw unavailable();
  const encrypted=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  return JSON.stringify({v:1,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),data:encrypted.toString('base64url')});
}
export function decryptYouTubeEnvelope(envelope,env,workspaceId,recordId,purpose) {
  const key=tokenKey(env);
  try {
    if (typeof envelope!=='string' || envelope.length>140000) throw new Error();
    const e=JSON.parse(envelope);
    if (e.v!==1 || Object.keys(e).sort().join(',')!=='data,iv,tag,v') throw new Error();
    const decode=(value,size) => {
      if (typeof value!=='string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
      const b=Buffer.from(value,'base64url');
      if (b.toString('base64url')!==value || (size && b.length!==size)) throw new Error();
      return b;
    };
    const cipher=createDecipheriv('aes-256-gcm',key,decode(e.iv,12));
    cipher.setAAD(aad(workspaceId,recordId,purpose)); cipher.setAuthTag(decode(e.tag,16));
    return JSON.parse(Buffer.concat([cipher.update(decode(e.data)),cipher.final()]).toString('utf8'));
  } catch { throw new ApiError(503,'integration_data_unavailable','تعذر قراءة بيانات التكامل بأمان'); }
}
async function schemaReady(db) {
  try {
    const versions=await db.query('SELECT MAX(version) AS version FROM taswiqat_migrations');
    if (Number(versions[0]?.version)<4 || !versions[0]?.version) return false;
    const rows=await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?,?,?)',YOUTUBE_TABLE_NAMES);
    const tables=new Set(rows.map(r=>r.TABLE_NAME || r.table_name));
    return YOUTUBE_TABLE_NAMES.every(t=>tables.has(t));
  } catch { return false; }
}
async function requireSchema(db) { if (!await schemaReady(db)) fail(503,'integration_not_configured','ربط YouTube غير مهيأ حاليًا'); }
function configured(env,userId) { const c=youtubeConfiguration(env,userId); if (!c.ready) configError(); return c; }
async function authorize(db,user,workspaceId,{withdraw=false,quota=false}={}) {
  if (!user?.id || user.status!=='active') fail(403,'user_suspended','الحساب غير نشط');
  await assertActiveUser(db,user.id);
  const w=await getWorkspace(db,workspaceId,user.id,{manage:true,write:!withdraw});
  if (w.id!==workspaceId) fail(404,'workspace_not_found','مساحة العمل غير موجودة');
  if (!withdraw) {
    const {plan}=await limitsFor(db,w.id,{write:true});
    if (plan.active===false) fail(403,'subscription_inactive','الباقة غير متاحة');
    if (quota) {
      const connections=await db.query('SELECT provider FROM taswiqat_connections WHERE workspace_id=?',[w.id]);
      let state; try {state=json(w.state_json);} catch {throw unavailable();}
      if (!Array.isArray(state?.selected) || state.selected.some(v=>!CHANNEL_IDS.includes(v))) throw unavailable();
      const ids=new Set([...state.selected,...connections.map(r=>r.provider),'yt']);
      if (!Number.isInteger(plan.channels) || ids.size>plan.channels) fail(409,'channel_quota','تم بلوغ حد قنوات الباقة');
    }
  }
  return w;
}
function canonicalRequest(req,env,c) {
  checkCsrf(req,env);
  const raw=req.auth.payload?.origin || req.get('X-Taswiqat-Origin') || req.get('Origin');
  if (!raw || allowedAuthOrigin(raw,env)!==c.origin) fail(409,'canonical_login_required','افتح التطبيق الأساسي وسجّل الدخول قبل ربط YouTube');
  // Validate explicit browser origins via the existing guarded CSRF canonical handling.
  if (!req.get('Origin') && !req.get('X-Taswiqat-Origin')) fail(403,'origin_mismatch','مصدر الطلب غير مسموح');
}
function thumbnail(value) {
  if (typeof value!=='string' || value.length>2048) return '';
  try {
    const u=new URL(value);
    const hosts=['yt3.ggpht.com','yt3.googleusercontent.com','i.ytimg.com','img.youtube.com','lh3.googleusercontent.com'];
    if (u.protocol!=='https:' || !hosts.includes(u.hostname) || u.port || u.username || u.password || u.hash) return '';
    return u.href;
  } catch {return '';}
}
export function verifiedYouTubeChannel(item,now=Date.now()) {
  if (!item || !CHANNEL_PATTERN.test(item.id) || typeof item.snippet?.title!=='string') fail(502,'channel_verification_failed','تعذر التحقق من القناة');
  const title=item.snippet.title.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
  if (!title) fail(502,'channel_verification_failed','تعذر التحقق من القناة');
  const thumbnails=item.snippet.thumbnails || {};
  return {channelId:item.id,title,thumbnailUrl:thumbnail(thumbnails.medium?.url || thumbnails.default?.url || thumbnails.high?.url),url:`https://www.youtube.com/channel/${item.id}`,verifiedAt:date(now).toISOString(),scope:'readonly'};
}
function safeDetails(value) {
  try {
    const d=json(value);
    if (!d || !CHANNEL_PATTERN.test(d.channelId) || typeof d.title!=='string' || !d.title.trim() || !Number.isFinite(millis(d.verifiedAt))) return null;
    return {channelId:d.channelId,title:d.title.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,160),thumbnailUrl:thumbnail(d.thumbnailUrl),url:`https://www.youtube.com/channel/${d.channelId}`,verifiedAt:date(millis(d.verifiedAt)).toISOString(),scope:'readonly'};
  } catch {return null;}
}
async function storedConnection(db,workspaceId) {
  const rows=await db.query("SELECT c.id,c.provider,c.status,c.public_json,t.token_version,t.channel_id,t.verified_at FROM taswiqat_connections c JOIN taswiqat_youtube_tokens t ON t.connection_id=c.id AND t.workspace_id=c.workspace_id WHERE c.workspace_id=? AND c.provider='yt'",[workspaceId]);
  if (rows.length>1) throw unavailable();
  return rows[0] || null;
}
function publicConnection(row,now=Date.now()) {
  if (!row) return null;
  const details=safeDetails(row.public_json);
  const fresh=details && millis(details.verifiedAt)>now-30*DAY && millis(details.verifiedAt)<=now+60000;
  const status=row.status==='connected' ? (fresh?'connected':'stale') : row.status==='needs_reauth'?'needs_reauth':'unavailable';
  return {id:row.id,provider:'yt',status,details:fresh?details:null};
}
function binding(req) { return {userId:req.auth.user.id,sessionHash:digest(req.auth.token)}; }
function validAttempt(a,req,workspaceId,now,status) {
  const b=binding(req);
  return a && a.user_id===b.userId && a.session_hash===b.sessionHash && a.workspace_id===workspaceId && a.service==='yt' && a.policy_version===POLICY_VERSION && a.status===status && millis(a.expires_at)>now;
}
function redirect(res,env,workspaceId,result) {
  const c=youtubeConfiguration(env);
  const origin=c.origin || DEFAULT_AUTH_ORIGIN;
  const id=idSchema.safeParse(workspaceId).success ? workspaceId : '';
  res.set('Cache-Control','private, no-store'); res.set('Referrer-Policy','no-referrer');
  res.redirect(302,`${origin}/?workspace=${encodeURIComponent(id)}&youtube=${result}#app`);
}

async function providerJson(url,options,services,{revoke=false}={}) {
  let response,data;
  try {
    response=await (services.fetcher || globalThis.fetch)(url,{...options,signal:AbortSignal.timeout(12000)});
    if (revoke) {
      if (response.ok) return {};
      data=await response.json().catch(()=>({}));
      if (response.status===400 && data.error==='invalid_token') return {};
    } else data=await response.json();
  } catch { fail(502,'youtube_provider_unavailable','تعذر التواصل مع YouTube؛ حاول لاحقًا'); }
  if (!response.ok || data?.error) {
    const code=typeof data?.error==='string' ? data.error : '';
    const reasons=Array.isArray(data?.error?.errors) ? data.error.errors.map(e=>e.reason) : [];
    if (!revoke && (code==='invalid_grant' || code==='invalid_token' || response.status===401 || reasons.includes('authError') || reasons.includes('insufficientPermissions'))) fail(409,'requires_reauth','يلزم تجديد إذن YouTube');
    fail(502,'youtube_provider_unavailable','تعذر التواصل مع YouTube؛ حاول لاحقًا');
  }
  if (!data || typeof data!=='object' || Array.isArray(data)) fail(502,'youtube_provider_invalid','استجابة YouTube غير صالحة');
  return data;
}
export function validateYouTubeToken(data,now=Date.now()) {
  if (!data || typeof data.access_token!=='string' || !data.access_token || data.access_token.length>16384 || /[\r\n\0]/.test(data.access_token) || data.token_type!=='Bearer' || !Number.isInteger(data.expires_in) || data.expires_in<30 || data.expires_in>7200) fail(502,'youtube_token_invalid','لم يتم التحقق من إذن YouTube');
  const scopes=typeof data.scope==='string' ? data.scope.trim().split(/\s+/) : [];
  if (scopes.length!==1 || scopes[0]!==YOUTUBE_SCOPE) fail(409,'youtube_scope_invalid','إذن YouTube للقراءة فقط مطلوب');
  if (data.refresh_token!==undefined && (typeof data.refresh_token!=='string' || !data.refresh_token || data.refresh_token.length>16384 || /[\r\n\0]/.test(data.refresh_token))) fail(502,'youtube_token_invalid','لم يتم التحقق من إذن YouTube');
  return {accessToken:data.access_token,refreshToken:data.refresh_token || null,expiresAt:now+data.expires_in*1000,scope:YOUTUBE_SCOPE,tokenType:'Bearer'};
}
async function exchangeCode(code,verifier,env,services,now) {
  const c=configured(env);
  const data=await providerJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.TASWIQAT_YOUTUBE_CLIENT_ID,client_secret:env.TASWIQAT_YOUTUBE_CLIENT_SECRET,grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:`${c.origin}/api/oauth/google/callback`}).toString()},services);
  return validateYouTubeToken(data,now);
}
async function refreshGrant(tokens,env,services,now) {
  if (!tokens?.refreshToken || tokens.scope!==YOUTUBE_SCOPE || tokens.tokenType!=='Bearer') fail(409,'requires_reauth','يلزم تجديد إذن YouTube');
  const data=await providerJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.TASWIQAT_YOUTUBE_CLIENT_ID,client_secret:env.TASWIQAT_YOUTUBE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:tokens.refreshToken}).toString()},services);
  const next=validateYouTubeToken(data,now);
  next.refreshToken ||= tokens.refreshToken;
  return next;
}
async function channelsMine(tokens,services,now) {
  const candidates=new Map(),seenPages=new Set(); let page='';
  for (let i=0;i<MAX_PAGES;i++) {
    const url=new URL('https://www.googleapis.com/youtube/v3/channels');
    url.search=new URLSearchParams({mine:'true',part:'id,snippet',maxResults:'50',fields:'items(id,snippet(title,thumbnails)),nextPageToken',...(page?{pageToken:page}:{})}).toString();
    const data=await providerJson(url.toString(),{method:'GET',headers:{Authorization:`Bearer ${tokens.accessToken}`}},services);
    if (!Array.isArray(data.items) || data.items.length>50) fail(502,'channel_verification_failed','تعذر التحقق من القنوات');
    for (const item of data.items) {
      const channel=verifiedYouTubeChannel(item,now); candidates.set(channel.channelId,channel);
      if (candidates.size>MAX_CHANNELS) fail(409,'channel_selection_unavailable','عدد القنوات يتجاوز حد الاختيار الآمن');
    }
    if (!data.nextPageToken) return [...candidates.values()];
    if (typeof data.nextPageToken!=='string' || data.nextPageToken.length>2048 || seenPages.has(data.nextPageToken)) fail(502,'channel_verification_failed','تعذر التحقق من القنوات');
    page=data.nextPageToken; seenPages.add(page);
  }
  fail(409,'channel_selection_unavailable','تعذر حصر القنوات بأمان؛ اختر هوية قناة محددة لدى Google');
}
async function revokeGrant(token,services) {
  await providerJson('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString()},services,{revoke:true});
}
async function expireAttempt(db,id) { await db.query('DELETE FROM taswiqat_youtube_attempts WHERE id=?',[id]); }
async function tokensFor(db,workspaceId) { return (await db.query('SELECT * FROM taswiqat_youtube_tokens WHERE workspace_id=?',[workspaceId]))[0] || null; }
function assertBase(attempt,old,now=Date.now()) {
  if ((attempt.base_connection_id || null)!==(old?.connection_id || null) || Number(attempt.base_token_version || 0)!==Number(old?.token_version || 0) || (old?.lease_until && millis(old.lease_until)>now)) fail(409,'connection_changed','اتصال القناة تغير؛ أعد المحاولة');
}
async function reusePreviousGrant(db,env,req,a,old,services) {
  const now=nowOf(services),owner=randomUUID();
  req.auth=await assertCurrentSession(db,req.auth,env);
  if (!await claimToken(db,old,owner,now)) fail(409,'connection_changed','الاتصال قيد التجديد؛ أعد المحاولة');
  try {
    await maintenanceAuthorization(db,old,env);
    const prior=decryptYouTubeEnvelope(old.token_cipher,env,a.workspace_id,old.connection_id,'tokens');
    if (prior.channelId!==old.channel_id || prior.userId!==old.user_id) throw unavailable();
    const refreshed={...prior,...await refreshGrant(prior,env,services,now)};
    req.auth=await assertCurrentSession(db,req.auth,env);
    const channels=await channelsMine(refreshed,services,nowOf(services));
    req.auth=await assertCurrentSession(db,req.auth,env);
    const same=channels.find(c=>c.channelId===old.channel_id);
    if (!same) fail(409,'requires_reauth','يلزم تجديد إذن YouTube');
    const saved=await maintenanceSave(db,old,owner,async tx=>{
      req.auth=await assertCurrentSession(tx,req.auth,env);
      await maintenanceAuthorization(tx,old,env);
      await tx.query("UPDATE taswiqat_connections SET status='connected',public_json=? WHERE id=? AND workspace_id=? AND provider='yt'",[JSON.stringify(same),old.connection_id,a.workspace_id]);
      const cipher=encryptYouTubeEnvelope(refreshed,env,a.workspace_id,old.connection_id,'tokens');
      await tx.query('UPDATE taswiqat_youtube_tokens SET token_cipher=?,token_version=token_version+1,verified_at=?,next_check_at=?,retry_count=0,lease_owner=NULL,lease_until=NULL WHERE workspace_id=?',[cipher,date(now),date(now+DAY),a.workspace_id]);
      // A cancelled handshake may retain rotation only while its session is still valid.
      // Only THIS still-live attempt may advance its optimistic base version.
      await tx.query("UPDATE taswiqat_youtube_attempts SET base_token_version=? WHERE id=? AND status='exchanging' AND base_token_version=?",[Number(old.token_version)+1,a.id,old.token_version]);
    });
    if (!saved) fail(409,'connection_changed','الاتصال تغير أثناء التجديد');
    a.base_token_version=Number(old.token_version)+1;
    return {tokens:refreshed,channels:[same]};
  } catch(e) {
    const permanent=e instanceof ApiError && ['requires_reauth','youtube_scope_invalid','user_suspended','workspace_not_found','membership_suspended','manager_required'].includes(e.code);
    await maintenanceSave(db,old,owner,async tx=>{
      if (permanent) await purgeAuthorizedMetadata(tx,old,{reauth:true,now});
      else await tx.query('UPDATE taswiqat_youtube_tokens SET next_check_at=?,retry_count=retry_count+1,lease_owner=NULL,lease_until=NULL WHERE workspace_id=?',[date(now+60000),old.workspace_id]);
    });
    throw e;
  }
}
async function commitConnection(db,env,req,attemptId,channelId,services) {
  const now=nowOf(services);
  return db.transaction(async tx=>{
    req.auth=await assertCurrentSession(tx,req.auth,env);
    await configuredDb(tx,env,req.auth.user.id);
    await authorize(tx,req.auth.user,req.body?.workspaceId || req.youtubeWorkspaceId,{quota:true});
    const rows=await tx.query('SELECT * FROM taswiqat_youtube_attempts WHERE id=? FOR UPDATE',[attemptId]);
    const a=rows[0],workspaceId=req.body?.workspaceId || req.youtubeWorkspaceId;
    if (!validAttempt(a,req,workspaceId,now,'pending')) fail(409,'youtube_attempt_invalid','طلب الربط منتهي أو غير صالح');
    const old=await tokensFor(tx,workspaceId); assertBase(a,old,now);
    const payload=decryptYouTubeEnvelope(a.payload_cipher,env,workspaceId,a.id,'pending');
    const channel=payload.channels?.find(c=>c.channelId===channelId);
    const details=safeDetails(channel);
    if (!details || payload.userId!==a.user_id || payload.sessionHash!==a.session_hash || payload.policyVersion!==POLICY_VERSION || !payload.tokens?.refreshToken || payload.tokens.scope!==YOUTUBE_SCOPE || payload.tokens.expiresAt<=now) fail(409,'youtube_attempt_invalid','اختر قناة متحققة من محاولة صالحة');
    const id=old?.connection_id || randomUUID();
    const cipher=encryptYouTubeEnvelope({...payload.tokens,channelId,userId:a.user_id,policyVersion:POLICY_VERSION,consentedAt:payload.consentedAt},env,workspaceId,id,'tokens');
    // Canonical revision lock serializes quota, permissions, cancellation and all final saves.
    // The unique workspace token row plus the bound base token_version reject stale handshakes.
    await tx.query("DELETE FROM taswiqat_connections WHERE workspace_id=? AND provider='yt'",[workspaceId]);
    await tx.query("INSERT INTO taswiqat_connections(id,workspace_id,provider,status,public_json) VALUES(?,?,'yt','connected',?)",[id,workspaceId,JSON.stringify(details)]);
    if (old) await tx.query('UPDATE taswiqat_youtube_tokens SET user_id=?,channel_id=?,token_cipher=?,token_version=token_version+1,reconsent_required=FALSE,verified_at=?,next_check_at=?,retry_count=0,lease_owner=NULL,lease_until=NULL WHERE workspace_id=?',[a.user_id,channelId,cipher,date(now),date(now+DAY),workspaceId]);
    else await tx.query('INSERT INTO taswiqat_youtube_tokens(workspace_id,connection_id,user_id,channel_id,token_cipher,verified_at,next_check_at) VALUES(?,?,?,?,?,?,?)',[workspaceId,id,a.user_id,channelId,cipher,date(now),date(now+DAY)]);
    await expireAttempt(tx,a.id);
    return {id,provider:'yt',status:'connected',details};
  });
}
async function stagePending(db,env,req,a,tokens,channels,services) {
  const now=nowOf(services);
  return db.transaction(async tx=>{
    req.auth=await assertCurrentSession(tx,req.auth,env);
    await authorize(tx,req.auth.user,a.workspace_id,{quota:true});
    const current=(await tx.query('SELECT * FROM taswiqat_youtube_attempts WHERE id=? FOR UPDATE',[a.id]))[0];
    if (!validAttempt(current,req,a.workspace_id,now,'exchanging')) fail(409,'youtube_attempt_invalid','طلب الربط منتهي أو غير صالح');
    assertBase(a,await tokensFor(tx,a.workspace_id),now);
    const cipher=encryptYouTubeEnvelope({tokens,channels,userId:a.user_id,sessionHash:a.session_hash,policyVersion:POLICY_VERSION,consentedAt:date(millis(a.created_at)).toISOString()},env,a.workspace_id,a.id,'pending');
    const result=await tx.query("UPDATE taswiqat_youtube_attempts SET status='pending',payload_cipher=?,expires_at=? WHERE id=? AND status='exchanging'",[cipher,date(Math.min(now+PENDING_TTL,millis(a.created_at)+ATTEMPT_TTL)),a.id]);
    if (result.affectedRows!==1) fail(409,'youtube_attempt_invalid','طلب الربط غير متاح');
  });
}
async function statusFor(db,user,workspaceId,env,services={},req) {
  await authorize(db,user,workspaceId,{withdraw:true});
  const c=await configurationForDb(db,env,user.id),schema=await schemaReady(db),now=nowOf(services);
  if (!schema) return {ready:false,reason:'integration_not_configured',mode:c.mode,policyVersion:POLICY_VERSION,connection:null,pending:null};
  const row=await storedConnection(db,workspaceId),connection=publicConnection(row,now);
  const revocations=await db.query('SELECT id FROM taswiqat_youtube_revocations WHERE workspace_id=? AND expires_at>? LIMIT 1',[workspaceId,date(now)]);
  let pending=null;
  if (req && c.ready) {
    const a=(await db.query('SELECT * FROM taswiqat_youtube_attempts WHERE workspace_id=?',[workspaceId]))[0];
    if (validAttempt(a,req,workspaceId,now,'pending')) {
      const payload=decryptYouTubeEnvelope(a.payload_cipher,env,workspaceId,a.id,'pending');
      if (payload.userId===user.id && payload.sessionHash===digest(req.auth.token) && payload.policyVersion===POLICY_VERSION) {
        const channels=Array.isArray(payload.channels) ? payload.channels.map(safeDetails).filter(Boolean) : [];
        if (channels.length && channels.length<=MAX_CHANNELS) pending={channels,replacing:!!connection};
      }
    }
  }
  return {ready:c.ready,reason:c.reason || (revocations.length?'revocation_pending':connection?.status==='needs_reauth'?'requires_reauth':null),mode:c.mode,policyVersion:POLICY_VERSION,connection,pending};
}
export async function youtubeCapabilities(db,user,workspaceId,env={}) {
  try {
    const s=await statusFor(db,user,workspaceId,env);
    let read=false,reason=s.reason;
    if (s.ready && s.connection?.status==='connected') {
      try {
        await authorize(db,user,workspaceId);
        const row=await tokensFor(db,workspaceId);
        await maintenanceAuthorization(db,row,env);
        const tokens=decryptYouTubeEnvelope(row.token_cipher,env,workspaceId,row.connection_id,'tokens');
        read=!!tokens.refreshToken && tokens.scope===YOUTUBE_SCOPE && tokens.channelId===row.channel_id && tokens.userId===row.user_id;
        if (!read) reason='requires_reauth';
      } catch(e) {if (!(e instanceof ApiError)) throw e;reason=e.code;}
    }
    return {ready:s.ready,reason,mode:s.mode,connection:s.connection,read};
  } catch(e) {if (e instanceof ApiError) throw e;throw unavailable();}
}
export function mountYouTubeRoutes(app,db,env,wrap,authenticate,services={}) {
  const safeWrap=fn=>wrap(async(req,res)=>{
    res.set('Cache-Control','private, no-store'); res.set('Referrer-Policy','no-referrer');
    try {await fn(req,res);} catch(e) {if (e instanceof ApiError) throw e;throw unavailable();}
  });
  app.get('/api/oauth/google/status',authenticate,safeWrap(async(req,res)=>{
    const workspaceId=parse(idSchema,req.query.workspaceId);
    res.json(await statusFor(db,req.auth.user,workspaceId,env,services,req));
  }));
  app.post('/api/oauth/google/connect',authenticate,safeWrap(async(req,res)=>{
    checkCsrf(req,env);
    if (req.query.service!=='yt') fail(400,'invalid_service','هذا المسار مخصص لـYouTube فقط');
    const input=parse(connectBody,req.body),c=await configuredDb(db,env,req.auth.user.id);
    canonicalRequest(req,env,c); await requireSchema(db);
    const now=nowOf(services),state=randomBytes(32).toString('base64url'),browser=randomBytes(32).toString('base64url'),id=randomUUID(),verifier=randomBytes(48).toString('base64url');
    const b=binding(req);
    let needRefresh=true;
    await db.transaction(async tx=>{
      await authorize(tx,req.auth.user,input.workspaceId,{quota:true});
      const revocations=await tx.query('SELECT id FROM taswiqat_youtube_revocations WHERE workspace_id=? AND expires_at>? LIMIT 1',[input.workspaceId,date(now)]);
      if (revocations.length) fail(409,'revocation_pending','إلغاء الإذن السابق قيد المحاولة؛ انتظر قبل إعادة الربط');
      const old=await tokensFor(tx,input.workspaceId);
      if (old?.token_cipher) {
        const previous=decryptYouTubeEnvelope(old.token_cipher,env,input.workspaceId,old.connection_id,'tokens');
        needRefresh=!!old.reconsent_required || !previous.refreshToken || previous.scope!==YOUTUBE_SCOPE || (await storedConnection(tx,input.workspaceId))?.status!=='connected';
      }
      // One live handshake per workspace. Superseded tokens are deleted locally, not revoked.
      await tx.query('DELETE FROM taswiqat_youtube_attempts WHERE workspace_id=?',[input.workspaceId]);
      const cipher=encryptYouTubeEnvelope({verifier},env,input.workspaceId,id,'attempt');
      await tx.query('INSERT INTO taswiqat_youtube_attempts(state_hash,id,workspace_id,user_id,session_hash,cookie_hash,policy_version,payload_cipher,base_connection_id,base_token_version,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[digest(state),id,input.workspaceId,b.userId,b.sessionHash,digest(browser),POLICY_VERSION,cipher,old?.connection_id || null,old?.token_version || null,date(now+ATTEMPT_TTL),date(now)]);
    });
    res.cookie(YOUTUBE_STATE_COOKIE,browser,{...cookieOptions,maxAge:ATTEMPT_TTL});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:env.TASWIQAT_YOUTUBE_CLIENT_ID,redirect_uri:`${c.origin}/api/oauth/google/callback`,response_type:'code',scope:YOUTUBE_SCOPE,access_type:'offline',include_granted_scopes:'false',prompt:needRefresh?'select_account consent':'select_account',state,code_challenge:digestChallenge(verifier),code_challenge_method:'S256'}).toString();
    res.json({url:url.toString()});
  }));
  const callbackAuth=(req,res,next)=>authenticate(req,res,error=>error?redirect(res,env,'','failed'):next());
  app.get('/api/oauth/google/callback',callbackAuth,wrap(async(req,res)=>{
    let a;
    try {
      await configuredDb(db,env,req.auth.user.id); await requireSchema(db);
      if (typeof req.query.state!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(req.query.state)) throw unavailable();
      const now=nowOf(services);
      a=await db.transaction(async tx=>{
        const candidate=(await tx.query('SELECT * FROM taswiqat_youtube_attempts WHERE state_hash=? FOR UPDATE',[digest(req.query.state)]))[0];
        const browser=req.cookies?.[YOUTUBE_STATE_COOKIE];
        if (!validAttempt(candidate,req,candidate?.workspace_id,now,'started') || typeof browser!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(browser) || !safeEqual(candidate.cookie_hash,digest(browser))) fail(409,'youtube_attempt_invalid','طلب الربط غير صالح');
        await authorize(tx,req.auth.user,candidate.workspace_id,{quota:true});
        const consumed=await tx.query("UPDATE taswiqat_youtube_attempts SET status='exchanging' WHERE id=? AND status='started' AND expires_at>?",[candidate.id,date(now)]);
        if (consumed.affectedRows!==1) fail(409,'youtube_attempt_invalid','طلب الربط مستخدم أو منتهي');
        return candidate;
      },{mutation:false});
      res.clearCookie(YOUTUBE_STATE_COOKIE,cookieOptions);
      if (req.query.error) {await expireAttempt(db,a.id);return redirect(res,env,a.workspace_id,req.query.error==='access_denied'?'cancelled':'failed');}
      if (typeof req.query.code!=='string' || !req.query.code || req.query.code.length>4096) throw unavailable();
      const payload=decryptYouTubeEnvelope(a.payload_cipher,env,a.workspace_id,a.id,'attempt');
      if (typeof payload.verifier!=='string' || !/^[A-Za-z0-9_-]{64}$/.test(payload.verifier)) throw unavailable();
      let tokens=await exchangeCode(req.query.code,payload.verifier,env,services,nowOf(services));
      req.auth=await assertCurrentSession(db,req.auth,env);
      let channels=await channelsMine(tokens,services,nowOf(services));
      req.auth=await assertCurrentSession(db,req.auth,env);
      if (!channels.length) {await expireAttempt(db,a.id);return redirect(res,env,a.workspace_id,'missing_channel');}
      if (!tokens.refreshToken) {
        // Reuse ONLY a previous grant that still verifies this SAME channel. Never infer
        // account identity from a public name or mix a newly selected account with old tokens.
        const old=await tokensFor(db,a.workspace_id); assertBase(a,old,nowOf(services));
        if (!old?.token_cipher || channels.length!==1 || channels[0].channelId!==old.channel_id) fail(409,'offline_access_required','أعد الموافقة للحصول على وصول يمكن تجديده');
        const reused=await reusePreviousGrant(db,env,req,a,old,services);
        tokens=reused.tokens; channels=reused.channels;
      }
      await stagePending(db,env,req,a,tokens,channels,services);
      const different=a.base_connection_id && (channels.length!==1 || (await tokensFor(db,a.workspace_id))?.channel_id!==channels[0].channelId);
      if (channels.length>1 || different) return redirect(res,env,a.workspace_id,'choose');
      req.youtubeWorkspaceId=a.workspace_id;
      await commitConnection(db,env,req,a.id,channels[0].channelId,services);
      return redirect(res,env,a.workspace_id,'connected');
    } catch(e) {
      if (a?.base_connection_id && e instanceof ApiError && e.code==='offline_access_required') {
        await db.query('UPDATE taswiqat_youtube_tokens SET reconsent_required=TRUE WHERE workspace_id=? AND connection_id=? AND token_version=?',[a.workspace_id,a.base_connection_id,a.base_token_version]).catch(()=>{});
      }
      if (a?.id) await expireAttempt(db,a.id).catch(()=>{});
      const result=e instanceof ApiError && ['requires_reauth','offline_access_required','youtube_scope_invalid'].includes(e.code)?'requires_reauth':'failed';
      return redirect(res,env,a?.workspace_id,result);
    }
  }));
  app.post('/api/oauth/google/confirm',authenticate,safeWrap(async(req,res)=>{
    const input=parse(confirmBody,req.body),c=await configuredDb(db,env,req.auth.user.id);
    canonicalRequest(req,env,c);await requireSchema(db);
    await authorize(db,req.auth.user,input.workspaceId,{quota:true});
    const a=(await db.query('SELECT * FROM taswiqat_youtube_attempts WHERE workspace_id=?',[input.workspaceId]))[0];
    if (!validAttempt(a,req,input.workspaceId,nowOf(services),'pending')) fail(409,'youtube_attempt_invalid','طلب الربط منتهي أو غير صالح');
    res.json({ok:true,connection:await commitConnection(db,env,req,a.id,input.channelId,services)});
  }));
  app.post('/api/oauth/google/cancel',authenticate,safeWrap(async(req,res)=>{
    checkCsrf(req,env);const input=parse(baseBody,req.body);await requireSchema(db);
    await db.transaction(async tx=>{
      await authorize(tx,req.auth.user,input.workspaceId,{withdraw:true});
      await tx.query('DELETE FROM taswiqat_youtube_attempts WHERE workspace_id=? AND user_id=? AND session_hash=?',[input.workspaceId,req.auth.user.id,digest(req.auth.token)]);
    });
    res.clearCookie(YOUTUBE_STATE_COOKIE,cookieOptions);res.json({ok:true});
  }));
  app.post('/api/oauth/google/disconnect',authenticate,safeWrap(async(req,res)=>{
    checkCsrf(req,env);const input=parse(baseBody,req.body);await requireSchema(db);
    const now=nowOf(services);let queueId=null,token=null,unavailableToken=false;
    await db.transaction(async tx=>{
      await authorize(tx,req.auth.user,input.workspaceId,{withdraw:true});
      const old=await tokensFor(tx,input.workspaceId);
      if (old && !old.token_cipher) unavailableToken=true;
      if (old?.token_cipher) {
        try {
          const payload=decryptYouTubeEnvelope(old.token_cipher,env,input.workspaceId,old.connection_id,'tokens');
          token=payload.refreshToken || payload.accessToken;
          if (typeof token!=='string' || !token || token.length>16384) throw unavailable();
          queueId=randomUUID();
          await tx.query('INSERT INTO taswiqat_youtube_revocations(id,workspace_id,token_cipher,requested_at,expires_at,next_attempt_at) VALUES(?,?,?,?,?,?)',[queueId,input.workspaceId,encryptYouTubeEnvelope({token},env,input.workspaceId,queueId,'revocation'),date(now),date(now+7*DAY),date(now)]);
        } catch(e) {
          // A broken/missing encryption key must NEVER block withdrawal and metadata deletion.
          // DB errors still roll back: do not misrepresent a failed local deletion.
          if (!(e instanceof ApiError)) throw e;
          token=null;queueId=null;unavailableToken=true;
        }
      }
      await tx.query('DELETE FROM taswiqat_youtube_attempts WHERE workspace_id=?',[input.workspaceId]);
      await tx.query('DELETE FROM taswiqat_youtube_tokens WHERE workspace_id=?',[input.workspaceId]);
      await tx.query("DELETE FROM taswiqat_connections WHERE workspace_id=? AND provider='yt'",[input.workspaceId]);
    });
    let revocation=unavailableToken?'unavailable':queueId?'pending':'not_needed';
    if (token && queueId) {
      try {await revokeGrant(token,services);await db.query('DELETE FROM taswiqat_youtube_revocations WHERE id=?',[queueId]);revocation='completed';}
      catch {revocation='pending';}
    }
    res.clearCookie(YOUTUBE_STATE_COOKIE,cookieOptions);
    res.json({ok:true,revocation,sharedGrantWarning:true});
  }));
}
function digestChallenge(verifier) { return Buffer.from(digest(verifier),'hex').toString('base64url'); }

async function maintenanceAuthorization(db,row,env) {
  const user=await assertActiveUser(db,row.user_id);
  if (!youtubeConfiguration(env,user.id).ready) fail(403,'testing_user_not_allowed','الوصول غير متاح');
  await getWorkspace(db,row.workspace_id,user.id,{manage:true,write:true});
  await limitsFor(db,row.workspace_id,{write:true});
}
async function claimToken(db,row,owner,now) {
  const result=await db.query('UPDATE taswiqat_youtube_tokens SET lease_owner=?,lease_until=? WHERE workspace_id=? AND token_version=? AND (lease_until IS NULL OR lease_until<=?)',[owner,date(now+LEASE_TTL),row.workspace_id,row.token_version,date(now)]);
  return result.affectedRows===1;
}
async function maintenanceSave(db,row,owner,fn) {
  return db.transaction(async tx=>{
    const current=await tokensFor(tx,row.workspace_id);
    if (!current || Number(current.token_version)!==Number(row.token_version) || current.lease_owner!==owner) return false;
    await fn(tx,current);return true;
  });
}
async function purgeAuthorizedMetadata(tx,row,{reauth=false,now}={}) {
  // Keep only the non-secret connection marker for reauthorization; discard authorized metadata.
  await tx.query("UPDATE taswiqat_connections SET status=?,public_json=? WHERE id=? AND workspace_id=? AND provider='yt'",[reauth?'needs_reauth':'stale','{}',row.connection_id,row.workspace_id]);
  await tx.query("UPDATE taswiqat_youtube_tokens SET channel_id='',token_cipher=?,token_version=token_version+1,lease_owner=NULL,lease_until=NULL,next_check_at=?,retry_count=0 WHERE workspace_id=?",['',date(now+DAY),row.workspace_id]);
}
/** Bounded, externally scheduled handler; no timer or endpoint is installed here.
 * Daily scheduling is recommended. Data is hidden on reads at 30 days even if a scheduler fails.
 * Local timestamp-based expiry needs only v4 schema, not provider configuration or a token key.
 * Refresh/revoke remain readiness-gated; scheduling remains the parent's responsibility.
 */
export async function runYouTubeMaintenance(db,env={},services={}) {
  const counts={disabled:false,checked:0,refreshed:0,revalidated:0,needsReauth:0,metadataPurged:0,retried:0,revoked:0,revocationExpired:0,attemptsExpired:0,skipped:0,failed:0};
  if (!await schemaReady(db)) return {...counts,disabled:true};
  counts.disabled=!(await configurationForDb(db,env)).ready;
  const now=nowOf(services),batch=Number.isInteger(services.batchSize)?Math.min(100,Math.max(1,services.batchSize)):25;
  // MySQL execute rejects a bound LIMIT here. Only the normalized integer batch
  // (1..100) and its positive remaining budgets may be embedded; values stay bound.
  try {
    const expired=await db.query(`SELECT id FROM taswiqat_youtube_attempts WHERE expires_at<=? ORDER BY expires_at LIMIT ${batch}`,[date(now)]);
    for (const a of expired) {
      const removed=await db.transaction(async tx=>{
        const current=(await tx.query('SELECT * FROM taswiqat_youtube_attempts WHERE id=? FOR UPDATE',[a.id]))[0];
        if (!current || millis(current.expires_at)>now) return false;
        await expireAttempt(tx,a.id);return true;
      });
      if (removed) counts.attemptsExpired++;else counts.skipped++;
    }
    const expiredRevocations=await db.query(`SELECT * FROM taswiqat_youtube_revocations WHERE (expires_at<=? OR requested_at<=?) AND (lease_until IS NULL OR lease_until<=?) ORDER BY expires_at LIMIT ${batch}`,[date(now),date(now-7*DAY),date(now)]);
    for (const row of expiredRevocations) {
      const removed=await db.transaction(async tx=>{
        const current=(await tx.query('SELECT * FROM taswiqat_youtube_revocations WHERE id=? FOR UPDATE',[row.id]))[0];
        if (!current || (current.lease_until && millis(current.lease_until)>now) || (millis(current.expires_at)>now && millis(current.requested_at)>now-7*DAY)) return false;
        return (await tx.query('DELETE FROM taswiqat_youtube_revocations WHERE id=?',[row.id])).affectedRows===1;
      });
      if (removed) counts.revocationExpired++;else counts.skipped++;
    }
    const retained=await db.query(`SELECT * FROM taswiqat_youtube_tokens WHERE verified_at<=? AND (token_cipher<>'' OR channel_id<>'') AND (lease_until IS NULL OR lease_until<=?) ORDER BY verified_at LIMIT ${batch}`,[date(now-30*DAY),date(now)]);
    for (const row of retained) {
      const owner=randomUUID();if (!await claimToken(db,row,owner,now)) {counts.skipped++;continue;}
      const saved=await maintenanceSave(db,row,owner,async(tx,current)=>{
        if (millis(current.verified_at)>now-30*DAY) throw unavailable();
        // Retention expiry discards ciphertext without decrypting or claiming Google revocation.
        await purgeAuthorizedMetadata(tx,current,{now});
      });
      if (saved) counts.metadataPurged++;else counts.skipped++;
    }
    if (counts.disabled) return counts;
    const revocationBudget=batch-expiredRevocations.length;
    const revocations=revocationBudget>0 ? await db.query(`SELECT * FROM taswiqat_youtube_revocations WHERE next_attempt_at<=? AND expires_at>? AND requested_at>? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at LIMIT ${revocationBudget}`,[date(now),date(now),date(now-7*DAY),date(now)]) : [];
    for (const row of revocations) {
      const owner=randomUUID();
      const claim=await db.query('UPDATE taswiqat_youtube_revocations SET lease_owner=?,lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<=?)',[owner,date(now+LEASE_TTL),row.id,date(now)]);
      if (claim.affectedRows!==1) {counts.skipped++;continue;}
      try {
        const payload=decryptYouTubeEnvelope(row.token_cipher,env,row.workspace_id,row.id,'revocation');
        if (typeof payload.token!=='string' || !payload.token || payload.token.length>16384) throw unavailable();
        await revokeGrant(payload.token,services);
        const done=await db.query('DELETE FROM taswiqat_youtube_revocations WHERE id=? AND lease_owner=?',[row.id,owner]);
        if (done.affectedRows===1) counts.revoked++;
      } catch {
        await db.query('UPDATE taswiqat_youtube_revocations SET attempts=attempts+1,next_attempt_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?',[date(Math.min(now+Math.min(DAY,60000*2**Math.min(Number(row.attempts)||0,10)),millis(row.expires_at))),row.id,owner]);counts.retried++;
      }
    }
    const tokenBudget=batch-retained.length;
    const rows=tokenBudget>0 ? await db.query(`SELECT * FROM taswiqat_youtube_tokens WHERE next_check_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_check_at LIMIT ${tokenBudget}`,[date(now),date(now)]) : [];
    for (const row of rows) {
      const owner=randomUUID();if (!await claimToken(db,row,owner,now)) {counts.skipped++;continue;}
      counts.checked++;
      let refreshed=false;
      try {
        await maintenanceAuthorization(db,row,env);
        if (!row.token_cipher) fail(409,'requires_reauth','يلزم تجديد إذن YouTube');
        let tokens=decryptYouTubeEnvelope(row.token_cipher,env,row.workspace_id,row.connection_id,'tokens');
        if (tokens.channelId!==row.channel_id || tokens.userId!==row.user_id || tokens.scope!==YOUTUBE_SCOPE || !tokens.refreshToken) fail(409,'requires_reauth','يلزم تجديد إذن YouTube');
        if (tokens.expiresAt<=now+60000) {tokens={...tokens,...await refreshGrant(tokens,env,services,now)};refreshed=true;}
        const channels=await channelsMine(tokens,services,now);
        const channel=channels.find(c=>c.channelId===row.channel_id);
        if (!channel) fail(409,'requires_reauth','يلزم تجديد إذن YouTube');
        const saved=await maintenanceSave(db,row,owner,async tx=>{
          await maintenanceAuthorization(tx,row,env);
          const cipher=encryptYouTubeEnvelope(tokens,env,row.workspace_id,row.connection_id,'tokens');
          await tx.query("UPDATE taswiqat_connections SET status='connected',public_json=? WHERE id=? AND workspace_id=? AND provider='yt'",[JSON.stringify(channel),row.connection_id,row.workspace_id]);
          await tx.query('UPDATE taswiqat_youtube_tokens SET token_cipher=?,token_version=token_version+1,verified_at=?,next_check_at=?,retry_count=0,lease_owner=NULL,lease_until=NULL WHERE workspace_id=?',[cipher,date(now),date(now+DAY),row.workspace_id]);
        });
        if (saved) {counts.revalidated++;if(refreshed) counts.refreshed++;} else counts.skipped++;
      } catch(e) {
        // Permanent grant failure, membership removal or suspended authorizer: no continued
        // access or retained authorized metadata. Transient failures never claim revocation.
        const permanent=e instanceof ApiError && ['requires_reauth','youtube_scope_invalid','user_suspended','workspace_not_found','membership_suspended','manager_required','testing_user_not_allowed'].includes(e.code);
        const oldMetadata=millis(row.verified_at)<=now-30*DAY;
        const saved=await maintenanceSave(db,row,owner,async tx=>{
          if (permanent) await purgeAuthorizedMetadata(tx,row,{reauth:true,now});
          else {
            // At the retention limit discard even the identity-bearing encrypted grant.
            // This is local expiry, NOT a claim that Google revoked the permission.
            if (oldMetadata) await purgeAuthorizedMetadata(tx,row,{now});
            else await tx.query('UPDATE taswiqat_youtube_tokens SET next_check_at=?,retry_count=retry_count+1,lease_owner=NULL,lease_until=NULL WHERE workspace_id=?',[date(now+Math.min(DAY,60000*2**Math.min(Number(row.retry_count)||0,10))),row.workspace_id]);
          }
        });
        if (saved) {
          if(permanent) {counts.needsReauth++;counts.metadataPurged++;}
          else {counts.retried++;if(oldMetadata) counts.metadataPurged++;}
        } else counts.skipped++;
      }
    }
  } catch {counts.failed++;}
  return counts;
}
