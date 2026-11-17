import { z } from 'zod';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new ApiError(status, code, message); };
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export const MAX_STATE_BYTES = 12 * 1024 * 1024;
export const CHANNEL_IDS = ['ig','tt','x','sc','wa','fb','gbp','ga4','gads','yt','gsc'];
const text = (max) => z.string().max(max);
export const idSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
const safeUrl = z.string().max(2048).refine(v => !v || validHttpsUrl(v), 'رابط HTTPS غير صالح');
export function validHttpsUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
export const businessSchema = z.object({ name: text(160).trim().min(1), type: text(120), market: text(160), website: safeUrl, bio: text(2000) }).strict();
export const selectedSchema = z.array(z.enum(CHANNEL_IDS)).max(11).refine(a => new Set(a).size === a.length, 'قنوات مكررة');
const mediaSchema = z.object({ name: text(255), type: z.enum(['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm']), data: z.string().max(4200000).optional(), url: text(2048).optional() }).strict().refine(v => !!v.data !== !!v.url, 'يجب تحديد data أو url فقط');
export const postSchema = z.object({ id: idSchema, title: text(240), text: text(20000), channels: selectedSchema, media: mediaSchema.nullable().optional(), campaignId: idSchema.nullable().optional(), scheduledFor: z.string().datetime({ offset: true }).nullable().optional(), status: z.enum(['draft','review','ready','planned']), author: idSchema, updatedAt: z.string().datetime({ offset: true }) }).strict();
export const campaignSchema = z.object({ id: idSchema, name: text(240).min(1), description: text(4000).optional(), startDate: text(40).optional(), endDate: text(40).optional(), status: z.enum(['draft','active','paused','completed']).optional(), budget: z.number().finite().min(0).max(1e9).optional(), channels: selectedSchema.optional(), goal: text(1000).optional() }).strict();
export const teamEntrySchema = z.object({ id: idSchema, name: text(160), email: z.union([emailSchema,z.literal('')]), role: z.enum(['owner','manager','employee']), status: z.enum(['active','suspended','pending','accepted','expired','revoked']).optional() }).strict();
export const workspaceStateSchema = z.object({ business: businessSchema, selected: selectedSchema, posts: z.array(postSchema).max(500), campaigns: z.array(campaignSchema).max(100), team: z.array(teamEntrySchema).max(100), theme: z.enum(['light','dark']) }).strict();
export const createWorkspaceSchema = z.object({ business: businessSchema, selected: selectedSchema }).strict();
export const statePutSchema = z.object({ state: workspaceStateSchema, version: z.number().int().nonnegative() }).strict();
export const invitationSchema = z.object({ name: text(160).trim().min(1), email: emailSchema, role: z.enum(['manager','employee']) }).strict();
export const ticketSchema = z.object({ subject: text(240).trim().min(1), message: text(10000).trim().min(1) }).strict();
export const siteSchema = z.object({ heroLine1: text(160), heroLine2: text(160), heroDescription: text(2000), contactEmail: z.union([emailSchema,z.literal('')]), notice: text(2000) }).strict();
export const planSchema = z.object({ id: idSchema, name: text(160).min(1), price: z.number().finite().min(0).max(1000000), channels: z.number().int().min(1).max(11), members: z.number().int().min(1).max(100), active: z.boolean().default(true) }).strict();
export function parse(schema, input) {
  const out = schema.safeParse(input);
  if (!out.success) fail(400, 'validation_error', 'مدخلات غير صالحة: ' + out.error.issues.slice(0, 4).map(i => i.path.join('.') + ' ' + i.message).join('; '));
  return out.data;
}
export function decodeMedia(media) {
  if (!media.data) fail(400, 'invalid_media', 'ملف dataURL مطلوب');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(media.data);
  if (!match || match[1] !== media.type || match[2].length % 4 !== 0) fail(400, 'invalid_media', 'ترميز الوسائط غير صالح');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) fail(413, 'media_too_large', 'الحد الأقصى للوسائط 3 MiB');
  if (buffer.toString('base64') !== match[2]) fail(400, 'invalid_media', 'ترميز الوسائط غير قياسي');
  const b = buffer;
  const signatures = {
    'image/png': b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/jpeg': b[0] === 255 && b[1] === 216 && b[2] === 255,
    'image/gif': ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()),
    'image/webp': b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP',
    'video/mp4': b.subarray(4,8).toString() === 'ftyp',
    'video/webm': b.subarray(0,4).equals(Buffer.from([26,69,223,163]))
  };
  if (!signatures[media.type]) fail(400, 'invalid_media', 'نوع الملف لا يطابق محتواه');
  return buffer;
}
export function validateState(state) {
  if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) fail(413, 'state_too_large', 'مساحة العمل أكبر من 12 MiB');
  for (const key of ['posts','campaigns']) if (new Set(state[key].map(x => x.id)).size !== state[key].length) fail(400, 'duplicate_id', 'معرّفات مكررة');
  for (const post of state.posts) {
    if (post.channels.some(c => !state.selected.includes(c))) fail(400, 'invalid_channel', 'قناة غير مختارة في مساحة العمل');
    if (post.campaignId && !state.campaigns.some(c => c.id === post.campaignId)) fail(400, 'invalid_campaign', 'حملة غير موجودة');
    if (post.status === 'planned' && !post.scheduledFor) fail(400, 'invalid_schedule', 'وقت التخطيط مطلوب');
    if (post.media?.data) decodeMedia(post.media);
    if (post.media?.url && !/^\/manus-storage\/taswiqat\/[a-zA-Z0-9_/-]+\.[a-z0-9]+$/.test(post.media.url)) fail(400, 'invalid_media_url', 'استخدم وسائط مرفوعة ومملوكة لمساحة العمل');
  }
  return state;
}
export function enforceEmployeeState(previous, next, userId) {
  for (const key of ['business','selected','campaigns','team','theme']) if (!isDeepStrictEqual(previous[key], next[key])) fail(403, 'employee_scope', 'الموظف لا يغيّر إعدادات النشاط أو الحملات أو الفريق');
  const before = new Map(previous.posts.map(p => [p.id,p]));
  const after = new Map(next.posts.map(p => [p.id,p]));
  for (const p of previous.posts) {
    const n = after.get(p.id);
    if (p.author !== userId || !['draft','review'].includes(p.status)) {
      if (!n || !isDeepStrictEqual(n, p)) fail(403,'employee_scope','لا يمكن تغيير منشور موظف آخر أو منشور معتمد');
    } else if (!n) fail(403,'employee_scope','حذف المنشورات غير متاح للموظف');
  }
  for (const p of next.posts) {
    if (isDeepStrictEqual(before.get(p.id), p)) continue;
    if (p.author !== userId || !['draft','review'].includes(p.status)) fail(403,'employee_scope','يمكن تعديل منشوراتك إلى مسودة أو مراجعة فقط');
  }
}
export function canonicalPosts(previous, next, userId, members) {
  const before = new Map(previous.posts.map(p => [p.id,p]));
  return next.posts.map(post => {
    const old = before.get(post.id);
    if (old && old.author !== post.author) fail(403,'immutable_author','هوية مؤلف المنشور ثابتة');
    if (!old && post.author !== userId) fail(403,'invalid_author','المنشور الجديد يجب أن ينسب إلى المستخدم الحالي');
    if (!old && !members.includes(post.author)) fail(403,'invalid_author','المؤلف ليس عضوًا');
    return isDeepStrictEqual(old, post) ? old : { ...post, updatedAt: new Date().toISOString() };
  });
}
export const digest = value => createHash('sha256').update(value).digest('hex');
