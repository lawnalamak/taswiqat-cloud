import express from 'express';
import cookieParser from 'cookie-parser';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDatabase, publicUser } from './db.mjs';
import { ApiError, fail, CHANNEL_IDS } from './validation.mjs';
import { authMiddleware, csrfToken, checkCsrf, requireAdmin, mountAuthRoutes, authOrigin } from './auth.mjs';
import { mountEmailAuthRoutes } from './auth-email.mjs';
import { mountProviderAuthRoutes } from './auth-provider.mjs';
import { mountWorkspaceRoutes } from './workspaces.mjs';
import { mountStorageRoutes } from './storage.mjs';
import { mountAdminRoutes, publicSettings } from './admin.mjs';
import { SCHEMA_VERSION, TABLES } from './migrate.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
export async function readiness(db) {
  try {
    await db.query('SELECT 1 AS ok');
    const rows=await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE ?',['taswiqat_%']);
    const found=new Set(rows.map(r=>r.TABLE_NAME || r.table_name));
    if (!TABLES.every(t=>found.has(t))) return {ready:false,database:true,schema:false};
    const versions=await db.query('SELECT MAX(version) AS version FROM taswiqat_migrations');
    const revision=await db.query('SELECT version FROM taswiqat_revision WHERE id=1');
    const settings=await db.query('SELECT id FROM taswiqat_site_settings WHERE id=1');
    const plans=await db.query('SELECT COUNT(*) AS n FROM taswiqat_plans');
    const schema=Number(versions[0]?.version)>=SCHEMA_VERSION && !!revision.length && !!settings.length && Number(plans[0]?.n)>0;
    return {ready:schema,database:true,schema,schemaVersion:schema?SCHEMA_VERSION:null};
  } catch { return {ready:false,database:false,schema:false}; }
}
function rateLimiter({limit=120,windowMs=60000,maxEntries=10000}={}) {
  const clients=new Map();
  return (req,res,next)=>{
    const now=Date.now();
    if (clients.size>=maxEntries) for (const [key,value] of clients) if (value.until<=now) clients.delete(key);
    const key=req.ip || req.socket.remoteAddress || 'unknown';
    let value=clients.get(key);
    if (!value || value.until<=now) { value={n:0,until:now+windowMs}; if (clients.size>=maxEntries) return next(new ApiError(429,'rate_limited','الخدمة مشغولة مؤقتًا')); clients.set(key,value); }
    if (++value.n>limit) { res.set('Retry-After',String(Math.ceil((value.until-now)/1000))); return next(new ApiError(429,'rate_limited','طلبات كثيرة؛ حاول لاحقًا')); }
    next();
  };
}
export function createApp({db=createDatabase(),env=process.env,distDir=path.join(root,'dist'),authServices={}}={}) {
  const app=express();
  app.locals.db=db;
  app.disable('x-powered-by');
  if (env.TASWIQAT_TRUST_PROXY==='true') app.set('trust proxy',1);
  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) res.set('Cache-Control','private, no-store');
    next();
  });
  app.use(cookieParser());
  app.use('/api',rateLimiter());
  app.use('/api/auth',express.json({limit:'8kb',strict:true,type:'application/json'}));
  app.use('/api/auth/apple/callback',express.urlencoded({limit:'12kb',extended:false,parameterLimit:10,type:'application/x-www-form-urlencoded'}));
  app.use(express.json({limit:'16mb',strict:true,type:'application/json'}));
  app.get('/api/health',wrap(async(req,res)=>{const health=await readiness(db);res.status(health.ready?200:503).json(health);}));
  const authenticate=authMiddleware(db,env);
  const optionalSession=(req,res,next)=>authenticate(req,res,e=>{
    if (e?.status===401) return res.json({authenticated:false});
    if (e) return next(e);
    next();
  });
  app.get('/api/session',optionalSession,wrap(async(req,res)=>{
    const rows=await db.query("SELECT w.id,w.name,m.role,w.status FROM taswiqat_memberships m JOIN taswiqat_workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND m.status='active' ORDER BY w.created_at,w.id",[req.auth.user.id]);
    res.json({authenticated:true,user:publicUser(req.auth.user),workspaces:rows,workspaceId:rows.find(w=>w.status==='active')?.id || rows[0]?.id || null,csrfToken:csrfToken(req.auth.token,env)});
  }));
  mountAuthRoutes(app,db,env,wrap,authenticate);
  mountEmailAuthRoutes(app,db,env,wrap,authServices);
  mountProviderAuthRoutes(app,db,env,wrap,authServices);
  app.get('/api/public/settings',wrap(async(req,res)=>{
    res.set('Access-Control-Allow-Origin','*');
    res.set('Cache-Control','public, max-age=30');
    res.json(await publicSettings(db));
  }));
  // Exact provider paths remain reserved; mount the integration router here in a later reviewed change.
  app.use('/api/oauth',(req,res)=>res.status(503).json({error:{code:'integration_not_configured',message:'تكامل منصات التواصل غير مهيأ بعد'}}));
  app.use('/api',(req,res,next)=>{
    const known=/^\/(workspaces(?:\/[^/]+\/(?:state|team|invitations|tickets|media))?|invitations\/accept|publisher\/capabilities|admin\/state)$/.test(req.path);
    if (!known) return res.status(404).json({error:{code:'api_not_found',message:'مسار API غير موجود'}});
    next();
  });
  app.use('/api',authenticate,wrap(async(req,res,next)=>{
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) checkCsrf(req,env);
    next();
  }));
  mountWorkspaceRoutes(app,db,wrap);
  mountStorageRoutes(app,db,env,wrap);
  app.get('/api/publisher/capabilities',(req,res)=>res.json({enabled:false,publishing:false,scheduling:false,channels:CHANNEL_IDS.map(id=>({id,connected:false,publish:false,schedule:false}))}));
  app.use('/api/admin',requireAdmin);
  mountAdminRoutes(app,db,wrap);
  app.use('/api',(req,res)=>res.status(404).json({error:{code:'api_not_found',message:'مسار API غير موجود'}}));
  app.get('/manus-routes.json',(req,res,next)=>res.sendFile(path.join(root,'manus-routes.json'),e=>e?next(e):undefined));
  app.get('/admin.html',(req,res,next)=>res.sendFile(path.join(distDir,'admin.html'),e=>{
    if (e?.status===404) res.sendFile(path.join(root,'admin.html'),x=>x?next(x):undefined);
    else if (e) next(e);
  }));
  app.use(express.static(distDir,{dotfiles:'deny',index:'index.html',fallthrough:true,redirect:false}));
  app.use((req,res)=>res.status(404).json({error:{code:'not_found',message:'الصفحة غير موجودة'}}));
  app.use((error,req,res,next)=>{
    if (res.headersSent) return next(error);
    if (req.path==='/api/auth/apple/callback') {
      let origin='';try{origin=authOrigin(env);}catch{/* Fixed relative fallback, never Host. */}
      res.set('Referrer-Policy','no-referrer');
      return res.redirect(303,`${origin}/#auth/login?error=provider_login_failed`);
    }
    const known=error instanceof ApiError;
    const status=known?error.status:error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:error.status===404?404:500;
    const code=known?error.code:status===413?'request_too_large':status===400?'invalid_json':status===404?'not_found':'internal_error';
    const message=known?error.message:status===413?'حجم الطلب أكبر من المسموح':status===400?'JSON غير صالح':status===404?'الملف غير موجود':'تعذر تنفيذ الطلب';
    if (status>=500) console.error('Backend request failed:',code); // Never log SQL/DSN/provider tokens.
    res.status(status).json({error:{code,message}});
  });
  return app;
}
export async function start({env=process.env}={}) {
  const db=createDatabase(env);
  const app=createApp({db,env});
  const port=Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('Invalid PORT');
  const server=app.listen(port,'0.0.0.0',()=>console.log(`Taswiqat backend listening on ${port}`));
  const shutdown=()=>server.close(()=>db.close().finally(()=>process.exit(0)));
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {app,server,db};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await start();
