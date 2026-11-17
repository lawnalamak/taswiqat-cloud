import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { createHash, createPrivateKey, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { fail, digest, emailSchema } from './validation.mjs';
import { newId, audit } from './db.mjs';
import { signingKey, authOrigin, allowedAuthOrigin, checkPreauth, cookieOptions, setSession, registrationEnabled, accountSchemaReady, accountEmailBlocked, assertAlternateUser, safeEqual, PREAUTH_COOKIE } from './auth.mjs';

const providers={
  google:{authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',jwks:'https://www.googleapis.com/oauth2/v3/certs',issuer:['https://accounts.google.com','accounts.google.com']},
  apple:{authorize:'https://appleid.apple.com/auth/authorize',token:'https://appleid.apple.com/auth/token',jwks:'https://appleid.apple.com/auth/keys',issuer:'https://appleid.apple.com'}
};
const remoteKeys=new Map();
const stateCookie=provider=>`taswiqat_oidc_${provider}`;
export function pkceChallenge(verifier) {return createHash('sha256').update(verifier).digest('base64url');}
function appleKey(env) {
  const key=createPrivateKey(env.TASWIQAT_APPLE_PRIVATE_KEY?.replace(/\\n/g,'\n'));
  if (key.asymmetricKeyType!=='ec' || key.asymmetricKeyDetails?.namedCurve!=='prime256v1') throw new Error();
  return key;
}
export function providerConfigured(provider,env) {
  try {
    if (!providers[provider]) return false;
    signingKey(env);const origin=authOrigin(env);
    if (provider==='google') return /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.TASWIQAT_GOOGLE_CLIENT_ID || '') &&
      typeof env.TASWIQAT_GOOGLE_CLIENT_SECRET==='string' && /^[^\s\x00-\x1f]{8,2048}$/.test(env.TASWIQAT_GOOGLE_CLIENT_SECRET);
    const hostname=new URL(origin).hostname;
    if (hostname==='localhost' || isIP(hostname.replace(/^\[|\]$/g,'')) || !hostname.includes('.')) return false;
    if (!/^[A-Za-z0-9.-]{3,255}$/.test(env.TASWIQAT_APPLE_CLIENT_ID || '') || !/^[A-Z0-9]{10}$/.test(env.TASWIQAT_APPLE_TEAM_ID || '') || !/^[A-Z0-9]{10}$/.test(env.TASWIQAT_APPLE_KEY_ID || '')) return false;
    appleKey(env);return true;
  } catch {return false;}
}
export async function appleClientSecret(env) {
  if (!providerConfigured('apple',env)) fail(503,'provider_not_configured','طريقة الدخول غير متاحة حاليًا');
  return new SignJWT({}).setProtectedHeader({alg:'ES256',kid:env.TASWIQAT_APPLE_KEY_ID}).setIssuer(env.TASWIQAT_APPLE_TEAM_ID)
    .setSubject(env.TASWIQAT_APPLE_CLIENT_ID).setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(appleKey(env));
}
export async function verifyProviderIdToken(provider,idToken,bound,env,jwks) {
  const config=providers[provider];
  if (!config || typeof idToken!=='string' || idToken.length>16000) fail(502,'provider_identity_invalid','تعذر التحقق من هوية الدخول');
  try {
    if (!jwks) {
      if (!remoteKeys.has(provider)) remoteKeys.set(provider,createRemoteJWKSet(new URL(config.jwks),{timeoutDuration:10000,cooldownDuration:30000}));
      jwks=remoteKeys.get(provider);
    }
    // Apple's ID tokens use RS256; ES256 is for the developer client-secret JWT.
    const {payload}=await jwtVerify(idToken,jwks,{algorithms:['RS256'],issuer:config.issuer,audience:env[provider==='google'?'TASWIQAT_GOOGLE_CLIENT_ID':'TASWIQAT_APPLE_CLIENT_ID'],requiredClaims:['iss','aud','sub','exp','iat','nonce'],maxTokenAge:'10m'});
    if (!safeEqual(payload.nonce,bound.nonce) || typeof payload.sub!=='string' || !/^[\x21-\x7e]{1,255}$/.test(payload.sub)) throw new Error();
    const clientId=env[provider==='google'?'TASWIQAT_GOOGLE_CLIENT_ID':'TASWIQAT_APPLE_CLIENT_ID'];
    if (payload.azp!==undefined && payload.azp!==clientId) throw new Error();
    if (Array.isArray(payload.aud) && payload.aud.length>1 && payload.azp!==clientId) throw new Error();
    const verified=payload.email_verified===true || payload.email_verified==='true';
    let email='';
    if (payload.email!==undefined && !(provider==='apple' && payload.email==='')) {
      const parsed=emailSchema.safeParse(payload.email);
      if (!parsed.success || !verified) throw new Error();email=parsed.data;
    }
    if (provider==='google' && !email) throw new Error();
    const name=typeof payload.name==='string' ? cleanName(payload.name):'';
    return {subject:payload.sub,email,name};
  } catch {fail(502,'provider_identity_invalid','تعذر التحقق من هوية الدخول');}
}
export async function exchangeProviderCode(provider,code,bound,env,{fetcher=fetch,jwks}={}) {
  const clientId=env[provider==='google'?'TASWIQAT_GOOGLE_CLIENT_ID':'TASWIQAT_APPLE_CLIENT_ID'];
  const clientSecret=provider==='google'?env.TASWIQAT_GOOGLE_CLIENT_SECRET:await appleClientSecret(env);
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'authorization_code',code,redirect_uri:bound.redirectUri});
  if (provider==='google') body.set('code_verifier',bound.verifier);
  let data;
  try {
    const response=await fetcher(providers[provider].token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),signal:AbortSignal.timeout(15000),redirect:'error'});
    data=await response.json();if (!response.ok || data.error) throw new Error();
  } catch {fail(502,'provider_exchange_failed','تعذر إكمال تسجيل الدخول');}
  // Never persist access_token or refresh_token; consume only the verified ID token.
  return verifyProviderIdToken(provider,data.id_token,bound,env,jwks);
}
function cleanName(value) {return value.replace(/[<>\x00-\x1f\x7f]/g,'').trim().slice(0,160);}
export function appleFirstName(value) {
  if (typeof value!=='string' || value.length>4000) return '';
  try {
    const user=JSON.parse(value);
    return cleanName([user?.name?.firstName,user?.name?.lastName].filter(v=>typeof v==='string').join(' '));
  } catch {return '';}
}
export async function resolveProviderUser(db,provider,info) {
  if (!providers[provider] || typeof info.subject!=='string' || !/^[\x21-\x7e]{1,255}$/.test(info.subject)) fail(502,'provider_identity_invalid','تعذر التحقق من هوية الدخول');
  return db.transaction(async tx=>{
    const {pin,blocked}=await accountEmailBlocked(tx,info.email);
    const rows=await tx.query('SELECT user_id,provider,subject FROM taswiqat_auth_identities WHERE provider=? AND subject=? FOR UPDATE',[provider,Buffer.from(info.subject)]);
    if (rows.length) {
      // Binary uniqueness and explicit byte equality both defend case-folded identity collisions.
      if (rows[0].provider!==provider || !Buffer.from(rows[0].subject).equals(Buffer.from(info.subject))) fail(409,'identity_collision','تعذر إكمال تسجيل الدخول');
      const users=await tx.query('SELECT * FROM taswiqat_users WHERE id=? FOR UPDATE',[rows[0].user_id]);
      const user=users[0];assertAlternateUser(user,pin,'taswiqat:oidc:');
      if (info.email && String(pin?.email || '').trim().toLowerCase()===info.email) fail(403,'account_unavailable','تعذر الدخول بهذه الطريقة');
      // Keep an established name when Apple omits its first-time user object; no email linking.
      if (!user.name && info.name) {await tx.query('UPDATE taswiqat_users SET name=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[info.name,user.id]);user.name=info.name;}
      await audit(tx,user.id,'login',user.id);return user;
    }
    if (!(await registrationEnabled(tx))) fail(403,'registration_disabled','تسجيل مستخدمين جدد موقوف حاليًا');
    // A same-email account must use its original provider; we never attach an identity to it.
    if (blocked) fail(403,'account_unavailable','تعذر الدخول بهذه الطريقة؛ استخدم طريقة الدخول المعتادة');
    const id=newId();const openId=`taswiqat:oidc:${id}`;
    const user={id,open_id:openId,name:info.name || 'مستخدم تسويقات',email:info.email || '',role:'user',status:'active',session_version:0};
    await tx.query('INSERT INTO taswiqat_users(id,open_id,name,email,email_authoritative,role) VALUES(?,?,?,?,?,\'user\')',[id,openId,user.name,user.email,!!info.email]);
    await tx.query('INSERT INTO taswiqat_auth_identities(provider,subject,user_id) VALUES(?,?,?)',[provider,Buffer.from(info.subject),id]);
    await audit(tx,id,'provider_registered',id);return user;
  });
}
export async function verifyProviderState(req,provider,env) {
  try {
    const cookie=req.cookies?.[stateCookie(provider)];
    if (typeof cookie!=='string' || cookie.length>4096) throw new Error();
    const {payload}=await jwtVerify(cookie,signingKey(env),{algorithms:['HS256']});
    const incoming=provider==='apple'?req.body?.state:req.query.state;
    if (payload.kind!=='oidc_state' || payload.provider!==provider || payload.appId!==env.MANUS_PROJECT_ID || !Number.isInteger(payload.exp) || !safeEqual(incoming,payload.state) ||
        payload.origin!==authOrigin(env) || payload.redirectUri!==`${authOrigin(env)}/api/auth/${provider}/callback` || !safeEqual(payload.challenge,digest(req.cookies?.[PREAUTH_COOKIE] || ''))) throw new Error();
    allowedAuthOrigin(payload.origin,env);
    return payload;
  } catch {fail(400,'oauth_state_invalid','طلب الدخول غير صالح أو منتهي');}
}
export function mountProviderAuthRoutes(app,db,env,wrap,{exchangeProvider=exchangeProviderCode}={}) {
  for (const provider of Object.keys(providers)) {
    app.get(`/api/auth/${provider}/start`,wrap(async(req,res)=>{
      if (!providerConfigured(provider,env)) fail(503,'provider_not_configured','طريقة الدخول غير متاحة حاليًا');
      const origin=allowedAuthOrigin(req.query.origin,env);
      const challenge=await checkPreauth(req,env);
      if (origin!==challenge.origin) fail(403,'origin_mismatch','مصدر الطلب غير مسموح');
      // Cookies cannot cross hostnames. Configure AUTH_ORIGIN to this Preview/custom domain,
      // or open login on the canonical host; never synthesize a cross-host cookie handoff.
      if (origin!==authOrigin(env)) fail(409,'canonical_login_required','افتح صفحة الدخول على عنوان التطبيق الرئيسي لإكمال هذه الطريقة');
      await accountSchemaReady(db);
      const state=randomBytes(32).toString('base64url');const nonce=randomBytes(32).toString('base64url');
      const verifier=randomBytes(48).toString('base64url');const redirectUri=`${authOrigin(env)}/api/auth/${provider}/callback`;
      const cookie=await new SignJWT({kind:'oidc_state',appId:env.MANUS_PROJECT_ID,provider,origin,redirectUri,state,nonce,verifier,challenge:digest(req.cookies[PREAUTH_COOKIE])})
        .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(signingKey(env));
      await db.query('INSERT INTO taswiqat_oauth_nonces(nonce_hash,expires_at) VALUES(?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))',[digest(state)]);
      res.cookie(stateCookie(provider),cookie,{...cookieOptions(origin,env),maxAge:600000});
      const url=new URL(providers[provider].authorize);
      url.search=new URLSearchParams({client_id:env[provider==='google'?'TASWIQAT_GOOGLE_CLIENT_ID':'TASWIQAT_APPLE_CLIENT_ID'],redirect_uri:redirectUri,response_type:'code',state,nonce,scope:provider==='google'?'openid email profile':'name email',...(provider==='google'?{code_challenge:pkceChallenge(verifier),code_challenge_method:'S256'}:{response_mode:'form_post'})}).toString();
      res.json({url:url.toString()});
    }));
    const callback=async(req,res)=>{
      res.set('Referrer-Policy','no-referrer');
      let origin;
      try {origin=authOrigin(env);} catch {res.redirect(303,'/#auth/login?error=provider_login_failed');return;}
      try {
        if (!providerConfigured(provider,env)) fail(503,'provider_not_configured','طريقة الدخول غير متاحة');
        const bound=await verifyProviderState(req,provider,env);
        res.clearCookie(stateCookie(provider),cookieOptions(origin,env));
        const result=await db.query('UPDATE taswiqat_oauth_nonces SET used=TRUE WHERE nonce_hash=? AND used=FALSE AND expires_at>UTC_TIMESTAMP(3)',[digest(bound.state)]);
        if (result.affectedRows!==1) fail(400,'oauth_state_used','طلب الدخول مستخدم أو منتهي');
        const input=provider==='apple'?req.body:req.query;
        if (input.error || typeof input.code!=='string' || !input.code || input.code.length>4096) fail(400,'oauth_code_missing','تعذر إكمال الدخول');
        const info=await exchangeProvider(provider,input.code,bound,env);
        if (provider==='apple') info.name=appleFirstName(input.user);
        const user=await resolveProviderUser(db,provider,info);
        await setSession(res,user,origin,env);
        res.redirect(303,`${origin}/#app`);
      } catch {
        res.clearCookie(stateCookie(provider),cookieOptions(origin,env));
        res.redirect(303,`${origin}/#auth/login?error=provider_login_failed`);
      }
    };
    if (provider==='apple') app.post('/api/auth/apple/callback',wrap(callback));
    else app.get('/api/auth/google/callback',wrap(callback));
  }
}
