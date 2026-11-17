import { z } from 'zod';
import { json, audit, newId, assertActiveUser } from './db.mjs';
import { parse, fail, idSchema, siteSchema, planSchema, emailSchema } from './validation.mjs';
import { createWorkspace } from './workspaces.mjs';
import { isDeepStrictEqual } from 'node:util';
import { publicChannelConnection } from './channel-public.mjs';
const str=n=>z.string().max(n);
const iso=z.string().datetime({offset:true}).optional();
const common={id:idSchema,createdAt:iso,updatedAt:iso};
const workspaceAdminSchema=z.object({...common,name:str(160).trim().min(1),businessType:str(120),ownerEmail:z.union([emailSchema,z.literal('')]),ownerId:idSchema.optional(),planId:idSchema,status:z.enum(['trial','active','suspended','archived']),notes:str(2000).default('')}).strict();
const userAdminSchema=z.object({...common,name:str(160),email:z.union([emailSchema,z.literal('')]),workspaceId:z.union([idSchema,z.literal('')]).optional(),role:z.enum(['admin','user','owner','manager','employee','editor','reviewer','viewer']),status:z.enum(['active','inactive','suspended','archived']),openId:str(255).optional()}).strict();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v);
const subscriptionAdminSchema=z.object({...common,workspaceId:idSchema,planId:idSchema,status:z.enum(['trial','active','suspended','cancelled','expired']),startDate:date,endDate:date,notes:str(2000).default(''),manual:z.boolean().optional()}).strict().refine(s=>s.endDate>s.startDate,'نهاية الفترة يجب أن تكون بعد بدايتها');
const ticketAdminSchema=z.object({...common,workspaceId:z.union([idSchema,z.literal('')]),userId:idSchema.optional(),title:str(240).min(1),description:str(10000).min(1),priority:z.enum(['low','normal','high','urgent']).default('normal'),assignee:str(160).default(''),status:z.enum(['open','in_progress','resolved','closed'])}).strict();
const adminPlanSchema=z.object({id:idSchema,name:str(160).min(1),price:z.number().finite().min(0).max(1000000),channels:z.number().int().min(1).max(11),members:z.number().int().min(1).max(100),enabled:z.boolean()}).strict();
const settingsSchema=z.object({theme:z.enum(['light','dark']).optional(),supportHours:str(500).optional(),registrationEnabled:z.boolean().optional(),trialDays:z.number().int().min(1).max(90).optional()}).strict();
export const adminPutSchema=z.object({version:z.number().int().nonnegative(),state:z.object({workspaces:z.array(workspaceAdminSchema).max(5000),users:z.array(userAdminSchema).max(5000),subscriptions:z.array(subscriptionAdminSchema).max(5000),plans:z.array(adminPlanSchema).min(1).max(20),connections:z.array(z.unknown()).max(5000),operations:z.array(z.unknown()).max(5000),tickets:z.array(ticketAdminSchema).max(5000),audit:z.array(z.unknown()).max(1000),site:siteSchema,settings:settingsSchema}).strict()}).strict();
const timestamp=v=>new Date(v).toISOString();
const day=v=>timestamp(v).slice(0,10);
export async function publicSettings(db) {
  const rows=await db.query('SELECT site_json FROM taswiqat_site_settings WHERE id=1');
  if (!rows.length) fail(503,'schema_not_ready','إعدادات الموقع غير جاهزة');
  const plans=(await db.query('SELECT data_json FROM taswiqat_plans ORDER BY id')).map(r=>{
    const p=json(r.data_json);return {id:p.id,name:p.name,price:p.price,channels:p.channels,members:p.members,enabled:!!p.active};
  });
  return {site:json(rows[0].site_json),plans};
}
export async function adminSnapshot(db,version) {
  const {site,plans}=await publicSettings(db);
  const settingsRow=await db.query('SELECT settings_json FROM taswiqat_site_settings WHERE id=1');
  const rawWorkspaces=await db.query('SELECT w.*,u.email AS owner_email,s.plan_id,s.status AS subscription_status FROM taswiqat_workspaces w JOIN taswiqat_users u ON u.id=w.owner_id LEFT JOIN taswiqat_subscriptions s ON s.workspace_id=w.id ORDER BY w.created_at,w.id');
  const workspaces=rawWorkspaces.map(w=>({id:w.id,name:w.name,businessType:json(w.state_json).business.type,ownerEmail:w.owner_email,ownerId:w.owner_id,planId:w.plan_id || 'basic',status:w.status==='active' && w.subscription_status==='trial' ? 'trial':w.status,notes:json(w.admin_json || '{}').notes || '',createdAt:timestamp(w.created_at),updatedAt:timestamp(w.updated_at)}));
  const memberships=await db.query('SELECT workspace_id,user_id,role FROM taswiqat_memberships ORDER BY created_at,workspace_id');
  const rawUsers=await db.query('SELECT * FROM taswiqat_users ORDER BY created_at,id');
  const users=rawUsers.map(u=>({id:u.id,name:u.name,email:u.email,workspaceId:memberships.find(m=>m.user_id===u.id)?.workspace_id || '',role:u.role,status:u.status,createdAt:timestamp(u.created_at),updatedAt:timestamp(u.updated_at)}));
  const rawSubs=await db.query('SELECT s.*,w.created_at FROM taswiqat_subscriptions s JOIN taswiqat_workspaces w ON w.id=s.workspace_id ORDER BY s.id');
  const subscriptions=rawSubs.map(s=>{
    const meta=json(s.admin_json || '{}');
    return {id:s.id,workspaceId:s.workspace_id,planId:s.plan_id,status:s.status,startDate:meta.startDate || day(s.created_at),endDate:meta.endDate || day(s.trial_ends_at || new Date(new Date(s.created_at).getTime()+14*86400000)),notes:meta.notes || '',manual:true,createdAt:timestamp(s.created_at),updatedAt:timestamp(s.updated_at)};
  });
  const rawTickets=await db.query('SELECT * FROM taswiqat_tickets ORDER BY created_at,id');
  const tickets=rawTickets.map(t=>{const meta=json(t.admin_json || '{}');return {id:t.id,workspaceId:t.workspace_id,userId:t.user_id,title:t.subject,description:t.message,priority:meta.priority || 'normal',assignee:meta.assignee || '',status:t.status,createdAt:timestamp(t.created_at),updatedAt:timestamp(t.updated_at)};});
  const rawConnections=await db.query('SELECT id,workspace_id,provider,status,public_json FROM taswiqat_connections ORDER BY id');
  const connections=rawConnections.map(c=>publicChannelConnection(c,{workspace:true}));
  // Planned content is a local plan, not a dispatch job or claimed successful publication.
  const operations=rawWorkspaces.flatMap(w=>json(w.state_json).posts.filter(p=>p.status==='planned').map(p=>({id:`${w.id}_${p.id}`,workspaceId:w.id,postId:p.id,title:p.title,status:'planned',scheduledFor:p.scheduledFor,published:false,dispatchEnabled:false})));
  const rawAudit=await db.query('SELECT a.*,u.name AS actor_name FROM taswiqat_audit a LEFT JOIN taswiqat_users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 1000');
  const log=rawAudit.map(a=>({id:`00000000-0000-4000-8000-${String(a.id).padStart(12,'0')}`,date:timestamp(a.created_at),actor:a.actor_name || 'النظام',message:a.action,entityId:a.entity_id,details:json(a.detail_json)}));
  if (version===undefined) version=Number((await db.query('SELECT version FROM taswiqat_revision WHERE id=1'))[0]?.version);
  return {state:{workspaces,users,subscriptions,plans,connections,operations,tickets,audit:log,site,settings:json(settingsRow[0].settings_json)},version};
}
export function validateAdminCollections(state,existing={}) {
  for (const key of ['workspaces','users','subscriptions','plans','tickets']) if (new Set(state[key].map(x=>x.id)).size!==state[key].length) fail(400,'duplicate_id','معرّفات مكررة في '+key);
  const plans=new Set([...state.plans.map(p=>p.id),...(existing.plans || []).map(p=>p.id)]);
  const workspaces=new Set([...state.workspaces.map(w=>w.id),...(existing.workspaces || []).map(w=>w.id)]);
  for (const w of state.workspaces) if (!plans.has(w.planId)) fail(400,'invalid_plan','باقة مساحة العمل غير موجودة');
  for (const sub of state.subscriptions) if (!plans.has(sub.planId) || !workspaces.has(sub.workspaceId)) fail(400,'invalid_subscription','مرجع الاشتراك غير صالح');
  for (const t of state.tickets) if (t.workspaceId && !workspaces.has(t.workspaceId)) fail(400,'invalid_workspace','مرجع التذكرة غير صالح');
}
export function enforceImmutableUsers(previous,next) {
  const old=new Map(previous.map(u=>[u.id,u]));
  for (const u of next) {
    const original=old.get(u.id);
    if (!original) fail(400,'login_identity_creation_prohibited','لا تُنشأ هويات دخول من لوحة الإدارة؛ يجب تسجيل الدخول أولًا');
    if (u.email!==original.email || u.role!==original.role || u.openId!==undefined) fail(403,'immutable_identity','البريد وopenId ودور النظام من الهوية الموثقة ولا تُعدّل عبر payload');
    if ((u.workspaceId || '')!==original.workspaceId) fail(403,'membership_api_required','تعديل العضويات عبر دعوات الفريق فقط');
    if (original.role==='admin' && u.status!=='active') fail(409,'last_admin_protected','لا يمكن تعليق المدير المثبت من لوحة الإدارة');
  }
  for (const u of previous) if (u.role==='admin' && !next.some(n=>n.id===u.id)) fail(409,'last_admin_protected','لا يمكن إزالة المدير المثبت');
}
export function mountAdminRoutes(app,db,wrap) {
  app.get('/api/admin/state',wrap(async(req,res)=>res.json(await db.transaction(tx=>adminSnapshot(tx),{mutation:false}))));
  app.put('/api/admin/state',wrap(async(req,res)=>{
    const input=parse(adminPutSchema,req.body);
    const output=await db.transaction(async tx=>{
      const actor=await assertActiveUser(tx,req.auth.user.id);
      const pins=await tx.query('SELECT pinned_open_id FROM taswiqat_private_admin WHERE id=1');
      if (actor.role!=='admin' || pins[0]?.pinned_open_id!==actor.open_id) fail(403,'admin_required','صلاحية المدير غير صالحة');
      if (tx.version!==input.version) fail(409,'version_conflict','بيانات النظام تغيرت؛ أعد تحميل النسخة الحالية');
      const before=(await adminSnapshot(tx,tx.version)).state;
      const next=input.state;
      validateAdminCollections(next,before);
      for (const key of ['connections','operations','audit']) if (!isDeepStrictEqual(next[key],before[key])) fail(403,'read_only_collection',key+' مشتق من الخادم وغير قابل للتعديل');
      enforceImmutableUsers(before.users,next.users);
      for (const p of next.plans) {
        const plan=parse(planSchema,{id:p.id,name:p.name,price:p.price,channels:p.channels,members:p.members,active:p.enabled});
        await tx.query('INSERT INTO taswiqat_plans(id,data_json) VALUES(?,?) ON DUPLICATE KEY UPDATE data_json=VALUES(data_json)',[p.id,JSON.stringify(plan)]);
      }
      for (const p of before.plans) if (!next.plans.some(n=>n.id===p.id)) await tx.query('UPDATE taswiqat_plans SET data_json=? WHERE id=?',[JSON.stringify({id:p.id,name:p.name,price:p.price,channels:p.channels,members:p.members,active:false}),p.id]);
      for (const user of next.users) {
        await tx.query('UPDATE taswiqat_users SET name=?,status=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[user.name,user.status==='inactive'?'suspended':user.status,user.id]);
      }
      for (const user of before.users) if (!next.users.some(n=>n.id===user.id)) await tx.query("UPDATE taswiqat_users SET status='archived',updated_at=UTC_TIMESTAMP(3) WHERE id=?",[user.id]);
      for (const workspace of next.workspaces) {
        const old=before.workspaces.find(w=>w.id===workspace.id);
        let id=workspace.id;
        if (!old) {
          const owners=await tx.query('SELECT id FROM taswiqat_users WHERE email=? AND email_authoritative=TRUE AND status=?',[workspace.ownerEmail,'active']);
          if (owners.length!==1) fail(409,'verified_owner_required','تهيئة مساحة تحتاج مستخدمًا موجودًا ببريد OAuth موثّق وحساب نشط');
          const input={business:{name:workspace.name,type:workspace.businessType,market:'',website:'',bio:''},selected:[]};
          const created=await createWorkspace(tx,owners[0].id,input,{planId:workspace.planId,requestedId:workspace.id});
          id=created.workspaceId;
        } else if (workspace.ownerEmail!==old.ownerEmail || (workspace.ownerId && workspace.ownerId!==old.ownerId)) fail(403,'immutable_owner','مالك النشاط ثابت؛ لا يُعدّل عبر البريد');
        const rows=await tx.query('SELECT state_json FROM taswiqat_workspaces WHERE id=?',[id]);
        const state=json(rows[0].state_json);
        state.business.name=workspace.name;state.business.type=workspace.businessType;
        await tx.query('UPDATE taswiqat_workspaces SET name=?,state_json=?,status=?,admin_json=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[workspace.name,JSON.stringify(state),workspace.status==='trial'?'active':workspace.status,JSON.stringify({notes:workspace.notes}),id]);
        await tx.query('UPDATE taswiqat_subscriptions SET plan_id=?,updated_at=UTC_TIMESTAMP(3) WHERE workspace_id=?',[workspace.planId,id]);
      }
      for (const w of before.workspaces) if (!next.workspaces.some(n=>n.id===w.id)) await tx.query("UPDATE taswiqat_workspaces SET status='archived',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",[w.id]);
      for (const sub of next.subscriptions) {
        const old=before.subscriptions.find(s=>s.id===sub.id);
        if (old && old.workspaceId!==sub.workspaceId) fail(403,'immutable_subscription','مساحة الاشتراك ثابتة');
        const rows=await tx.query('SELECT id FROM taswiqat_subscriptions WHERE workspace_id=?',[sub.workspaceId]);
        if (!rows.length) fail(409,'subscription_missing','الاشتراك ينشأ مع مساحة العمل فقط');
        if (!old && rows[0].id!==sub.id && before.subscriptions.some(s=>s.workspaceId===sub.workspaceId)) fail(409,'subscription_exists','يوجد اشتراك لمساحة العمل؛ عدّل السجل الموجود');
        const workspace=next.workspaces.find(w=>w.id===sub.workspaceId) || before.workspaces.find(w=>w.id===sub.workspaceId);
        if (workspace.planId!==sub.planId) fail(400,'plan_mismatch','باقة النشاط والاشتراك يجب أن تتطابق');
        await tx.query('UPDATE taswiqat_subscriptions SET plan_id=?,status=?,trial_ends_at=?,admin_json=?,updated_at=UTC_TIMESTAMP(3) WHERE workspace_id=?',[sub.planId,sub.status,new Date(sub.endDate+'T23:59:59.000Z'),JSON.stringify({startDate:sub.startDate,endDate:sub.endDate,notes:sub.notes}),sub.workspaceId]);
      }
      for (const sub of before.subscriptions) if (!next.subscriptions.some(n=>n.id===sub.id)) await tx.query("UPDATE taswiqat_subscriptions SET status='cancelled',updated_at=UTC_TIMESTAMP(3) WHERE id=?",[sub.id]);
      for (const ticket of next.tickets) {
        const old=before.tickets.find(t=>t.id===ticket.id);
        if (old && (old.workspaceId!==ticket.workspaceId || (ticket.userId && old.userId!==ticket.userId))) fail(403,'immutable_ticket_owner','ملكية التذكرة ثابتة');
        if (!old) {
          if (!ticket.workspaceId) fail(400,'workspace_required','التذاكر تتطلب مساحة عمل حقيقية');
          await tx.query('INSERT INTO taswiqat_tickets(id,workspace_id,user_id,subject,message,status,admin_json) VALUES(?,?,?,?,?,?,?)',[ticket.id,ticket.workspaceId,actor.id,ticket.title,ticket.description,ticket.status,JSON.stringify({priority:ticket.priority,assignee:ticket.assignee})]);
        } else await tx.query('UPDATE taswiqat_tickets SET subject=?,message=?,status=?,admin_json=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[ticket.title,ticket.description,ticket.status,JSON.stringify({priority:ticket.priority,assignee:ticket.assignee}),ticket.id]);
      }
      for (const ticket of before.tickets) if (!next.tickets.some(n=>n.id===ticket.id)) await tx.query("UPDATE taswiqat_tickets SET status='closed',updated_at=UTC_TIMESTAMP(3) WHERE id=?",[ticket.id]);
      await tx.query('UPDATE taswiqat_site_settings SET site_json=?,settings_json=? WHERE id=1',[JSON.stringify(next.site),JSON.stringify(next.settings)]);
      await audit(tx,actor.id,'admin_state_saved',null,{previousVersion:input.version,newVersion:input.version+1,manualSubscriptionChanges:true});
      return adminSnapshot(tx,tx.version+1);
    });
    res.json(output);
  }));
}
