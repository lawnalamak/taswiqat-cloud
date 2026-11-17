import { newId, json, audit, assertActiveUser } from './db.mjs';
import { fail, parse, createWorkspaceSchema, statePutSchema, invitationSchema, ticketSchema, validateState, enforceEmployeeState, canonicalPosts, digest, idSchema } from './validation.mjs';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { publicChannelConnection } from './channel-public.mjs';
export async function getWorkspace(db,id,userId,{write=false,manage=false}={}) {
  parse(idSchema,id);
  const rows=await db.query('SELECT w.*,m.role AS member_role,m.status AS member_status FROM taswiqat_workspaces w JOIN taswiqat_memberships m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?',[id,userId]);
  if (!rows.length) fail(404,'workspace_not_found','مساحة العمل غير موجودة');
  const w=rows[0];
  if (w.member_status!=='active') fail(403,'membership_suspended','العضوية موقوفة');
  if (write) {
    await assertActiveUser(db,userId);
    if (w.status!=='active') fail(403,'workspace_suspended','مساحة العمل غير نشطة');
  }
  if (manage && !['owner','manager'].includes(w.member_role)) fail(403,'manager_required','إدارة النشاط مطلوبة');
  return w;
}
export async function teamFor(db,workspaceId) {
  return db.query('SELECT u.id,u.name,u.email,m.role,m.status FROM taswiqat_memberships m JOIN taswiqat_users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at,u.id',[workspaceId]);
}
export async function invitationsFor(db,workspaceId) {
  const rows=await db.query('SELECT id,name,email,role,status,expires_at,created_at FROM taswiqat_invitations WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100',[workspaceId]);
  return rows.map(r=>({...r,status:r.status==='pending' && new Date(r.expires_at)<=new Date() ? 'expired':r.status}));
}
export async function limitsFor(db,workspaceId,{write=false}={}) {
  const rows=await db.query('SELECT s.*,p.data_json AS plan_json FROM taswiqat_subscriptions s JOIN taswiqat_plans p ON p.id=s.plan_id WHERE s.workspace_id=?',[workspaceId]);
  if (!rows.length) fail(409,'subscription_missing','سجل الاشتراك غير موجود');
  const s=rows[0];
  const plan=json(s.plan_json);
  if (write && (!['trial','active'].includes(s.status) || (s.status==='trial' && s.trial_ends_at && new Date(s.trial_ends_at)<=new Date()))) fail(403,'subscription_inactive','الاشتراك أو الفترة التجريبية غير نشطة؛ تواصل مع الدعم');
  return {subscription:s,plan};
}
export async function assertMemberCapacity(db,workspaceId,plan,extra=1) {
  const count=await db.query("SELECT COUNT(*) AS n FROM taswiqat_memberships WHERE workspace_id=? AND status='active'",[workspaceId]);
  const pending=await db.query("SELECT COUNT(*) AS n FROM taswiqat_invitations WHERE workspace_id=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3)",[workspaceId]);
  if (Number(count[0].n)+Number(pending[0].n)+extra>plan.members) fail(409,'member_quota','تم بلوغ حد أعضاء الباقة، بما يشمل الدعوات المعلّقة');
}
export async function canonicalState(db,w) {
  const state=json(w.state_json);
  state.team=await teamFor(db,w.id);
  return state;
}
export async function createWorkspace(tx,userId,input,{planId='basic',requestedId}={}) {
  await assertActiveUser(tx,userId);
  const count=await tx.query('SELECT COUNT(*) AS n FROM taswiqat_workspaces WHERE owner_id=?',[userId]);
  if (Number(count[0].n)>=10) fail(409,'workspace_limit','حد مساحات العمل المملوكة 10');
  const plans=await tx.query('SELECT data_json FROM taswiqat_plans WHERE id=?',[planId]);
  if (!plans.length || !json(plans[0].data_json).active) fail(409,'plan_unavailable','الباقة غير متاحة');
  if (input.selected.length>json(plans[0].data_json).channels) fail(409,'channel_quota','عدد القنوات يتجاوز الباقة');
  const settingsRows=await tx.query('SELECT settings_json FROM taswiqat_site_settings WHERE id=1');
  const trialDays=json(settingsRows[0]?.settings_json || '{}').trialDays || 14;
  const id=requestedId ? parse(idSchema,requestedId):newId('w');
  const state={business:input.business,selected:input.selected,posts:[],campaigns:[],team:[],theme:'light'};
  await tx.query('INSERT INTO taswiqat_workspaces(id,name,owner_id,state_json) VALUES(?,?,?,?)',[id,input.business.name,userId,JSON.stringify(state)]);
  await tx.query("INSERT INTO taswiqat_memberships(workspace_id,user_id,role) VALUES(?,?,'owner')",[id,userId]);
  await tx.query("INSERT INTO taswiqat_subscriptions(id,workspace_id,plan_id,status,trial_ends_at) VALUES(?,?,?,'trial',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? DAY))",[newId('sub'),id,planId,trialDays]);
  state.team=await teamFor(tx,id);
  await tx.query('UPDATE taswiqat_workspaces SET state_json=? WHERE id=?',[JSON.stringify(state),id]);
  await audit(tx,userId,'workspace_created',id,{planId});
  return {workspaceId:id,state,version:1,role:'owner'};
}
export function mountWorkspaceRoutes(app,db,wrap) {
  app.post('/api/workspaces',wrap(async(req,res)=>{
    const input=parse(createWorkspaceSchema,req.body);
    const result=await db.transaction(tx=>createWorkspace(tx,req.auth.user.id,input));
    res.status(201).json(result);
  }));
  app.get('/api/workspaces/:id/state',wrap(async(req,res)=>{
    const result=await db.transaction(async tx=>{
      const w=await getWorkspace(tx,req.params.id,req.auth.user.id);
      const state=await canonicalState(tx,w);
      const raw=await tx.query('SELECT id,provider,status,public_json FROM taswiqat_connections WHERE workspace_id=?',[w.id]);
      const connections=raw.map(r=>publicChannelConnection(r));
      const {subscription,plan}=await limitsFor(tx,w.id);
      return {state,version:Number(w.version),role:w.member_role,workspaceId:w.id,connections,subscription:{id:subscription.id,planId:subscription.plan_id,status:subscription.status,trialEndsAt:subscription.trial_ends_at,manual:true},plan};
    },{mutation:false});
    res.json(result);
  }));
  app.put('/api/workspaces/:id/state',wrap(async(req,res)=>{
    const input=parse(statePutSchema,req.body);
    validateState(input.state);
    const result=await db.transaction(async tx=>{
      const w=await getWorkspace(tx,req.params.id,req.auth.user.id,{write:true});
      if (Number(w.version)!==input.version) fail(409,'version_conflict','الحالة تغيرت؛ أعد تحميلها قبل الحفظ');
      const previous=await canonicalState(tx,w);
      const {plan}=await limitsFor(tx,w.id,{write:true});
      const connections=await tx.query('SELECT provider FROM taswiqat_connections WHERE workspace_id=?',[w.id]);
      const channelIds=new Set([...input.state.selected,...connections.map(c=>c.provider)]);
      if (channelIds.size>plan.channels) fail(409,'channel_quota','عدد القنوات المطلوبة والمسجلة يتجاوز الباقة');
      if (w.member_role==='employee') enforceEmployeeState(previous,input.state,req.auth.user.id);
      else if (!isDeepStrictEqual(input.state.team,previous.team)) fail(403,'team_read_only','الفريق يُدار عبر العضويات والدعوات لا عبر الحالة');
      const members=previous.team.map(m=>m.id);
      const state={...input.state,team:previous.team,posts:canonicalPosts(previous,input.state,req.auth.user.id,members)};
      for (const post of state.posts) if (post.media?.url) {
        const rows=await tx.query('SELECT user_id FROM taswiqat_media WHERE workspace_id=? AND object_key=?',[w.id,post.media.url.slice('/manus-storage/'.length)]);
        const mediaChanged=!isDeepStrictEqual(previous.posts.find(p=>p.id===post.id)?.media,post.media);
        if (!rows.length || (w.member_role==='employee' && mediaChanged && rows[0].user_id!==req.auth.user.id)) fail(403,'media_not_owned','الوسائط غير مملوكة لمساحة العمل أو المستخدم');
      }
      await tx.query('UPDATE taswiqat_workspaces SET state_json=?,name=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[JSON.stringify(state),state.business.name,w.id]);
      await audit(tx,req.auth.user.id,'workspace_state_saved',w.id,{version:input.version+1});
      return {state,version:input.version+1};
    });
    res.json(result);
  }));
  app.get('/api/workspaces/:id/team',wrap(async(req,res)=>{
    const w=await getWorkspace(db,req.params.id,req.auth.user.id);
    if (!['owner','manager'].includes(w.member_role)) fail(403,'manager_required','الفريق متاح للإدارة');
    res.json({members:await teamFor(db,w.id),invitations:await invitationsFor(db,w.id)});
  }));
  app.post('/api/workspaces/:id/invitations',wrap(async(req,res)=>{
    const input=parse(invitationSchema,req.body);
    const token=randomBytes(32).toString('base64url');
    const result=await db.transaction(async tx=>{
      const w=await getWorkspace(tx,req.params.id,req.auth.user.id,{write:true,manage:true});
      const {plan}=await limitsFor(tx,w.id,{write:true});
      await assertMemberCapacity(tx,w.id,plan);
      const duplicate=await tx.query("SELECT id FROM taswiqat_invitations WHERE workspace_id=? AND email=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3)",[w.id,input.email]);
      const member=await tx.query('SELECT u.id FROM taswiqat_memberships m JOIN taswiqat_users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?',[w.id,input.email]);
      if (duplicate.length || member.length) fail(409,'already_invited','العضو موجود أو لديه دعوة معلّقة');
      const id=newId('inv');
      const expiresAt=new Date(Date.now()+7*24*60*60*1000);
      await tx.query('INSERT INTO taswiqat_invitations(id,workspace_id,name,email,role,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,?,?,?)',[id,w.id,input.name,input.email,input.role,digest(token),expiresAt,req.auth.user.id]);
      await tx.query('UPDATE taswiqat_workspaces SET version=version+1 WHERE id=?',[w.id]);
      await audit(tx,req.auth.user.id,'invitation_created',w.id,{invitationId:id});
      return {invitation:{id,...input,status:'pending',expiresAt:expiresAt.toISOString()},token,path:`/#invite/${token}`,emailSent:false};
    });
    res.status(201).json(result);
  }));
  app.post('/api/invitations/accept',wrap(async(req,res)=>{
    if (!req.body || Object.keys(req.body).length!==1 || typeof req.body.token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(req.body.token)) fail(400,'invalid_token','رمز الدعوة غير صالح');
    const result=await db.transaction(async tx=>{
      const user=await assertActiveUser(tx,req.auth.user.id);
      if (!user.email_authoritative || !user.email) fail(403,'authoritative_email_required','أكمل تسجيل الدخول عبر المزوّد لتأكيد بريدك');
      const invitations=await tx.query('SELECT * FROM taswiqat_invitations WHERE token_hash=? FOR UPDATE',[digest(req.body.token)]);
      const inv=invitations[0];
      if (!inv || inv.status!=='pending' || new Date(inv.expires_at)<=new Date()) fail(410,'invitation_expired','الدعوة غير متاحة أو منتهية');
      if (inv.email!==user.email.toLowerCase()) fail(403,'invitation_email_mismatch','الدعوة مخصصة لبريد مستخدم آخر');
      const workspaces=await tx.query('SELECT * FROM taswiqat_workspaces WHERE id=?',[inv.workspace_id]);
      if (!workspaces[0] || workspaces[0].status!=='active') fail(403,'workspace_suspended','مساحة العمل غير نشطة');
      const existing=await tx.query('SELECT user_id FROM taswiqat_memberships WHERE workspace_id=? AND user_id=?',[inv.workspace_id,user.id]);
      if (existing.length) fail(409,'membership_exists','العضوية موجودة بالفعل');
      const {plan}=await limitsFor(tx,inv.workspace_id,{write:true});
      await assertMemberCapacity(tx,inv.workspace_id,plan,0);
      await tx.query('INSERT INTO taswiqat_memberships(workspace_id,user_id,role) VALUES(?,?,?)',[inv.workspace_id,user.id,inv.role]);
      await tx.query("UPDATE taswiqat_invitations SET status='accepted',accepted_by=? WHERE id=?",[user.id,inv.id]);
      await tx.query('UPDATE taswiqat_workspaces SET version=version+1 WHERE id=?',[inv.workspace_id]);
      await audit(tx,user.id,'invitation_accepted',inv.workspace_id,{invitationId:inv.id});
      return {workspaceId:inv.workspace_id,role:inv.role};
    });
    res.json(result);
  }));
  app.post('/api/workspaces/:id/tickets',wrap(async(req,res)=>{
    const input=parse(ticketSchema,req.body);
    const ticket=await db.transaction(async tx=>{
      const w=await getWorkspace(tx,req.params.id,req.auth.user.id,{write:true});
      const count=await tx.query("SELECT COUNT(*) AS n FROM taswiqat_tickets WHERE user_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)",[req.auth.user.id]);
      if (Number(count[0].n)>=10) fail(429,'ticket_limit','حد طلبات الدعم اليومية 10');
      const id=newId('ticket');
      await tx.query('INSERT INTO taswiqat_tickets(id,workspace_id,user_id,subject,message) VALUES(?,?,?,?,?)',[id,w.id,req.auth.user.id,input.subject,input.message]);
      await audit(tx,req.auth.user.id,'ticket_created',id,{});
      return {id,workspaceId:w.id,...input,status:'open',createdAt:new Date().toISOString()};
    });
    res.status(201).json({ticket});
  }));
  app.get('/api/workspaces/:id/tickets',wrap(async(req,res)=>{
    const w=await getWorkspace(db,req.params.id,req.auth.user.id);
    const owner=['owner','manager'].includes(w.member_role);
    const tickets=await db.query(`SELECT id,workspace_id AS workspaceId,user_id AS userId,subject,message,status,created_at AS createdAt,updated_at AS updatedAt FROM taswiqat_tickets WHERE workspace_id=?${owner?'':' AND user_id=?'} ORDER BY created_at DESC LIMIT 100`,owner?[w.id]:[w.id,req.auth.user.id]);
    res.json({tickets});
  }));
}
