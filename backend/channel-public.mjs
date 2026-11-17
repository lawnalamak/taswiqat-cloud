import { json } from './db.mjs';
const DAY = 86400000;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const THUMBNAIL_HOSTS = new Set(['yt3.ggpht.com','yt3.googleusercontent.com','i.ytimg.com','img.youtube.com','lh3.googleusercontent.com']);
function safeThumbnail(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return '';
    const url = new URL(value);
    return url.protocol === 'https:' && THUMBNAIL_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port && !url.hash ? url.href : '';
  } catch { return ''; }
}
export function publicChannelConnection(row, {workspace = false, now = Date.now()} = {}) {
  const value = {id:row.id,provider:row.provider,status:row.status};
  if (workspace) value.workspaceId = row.workspace_id;
  if (row.provider !== 'yt') return {...value,details:json(row.public_json)};
  let details;
  try { details = json(row.public_json); } catch { details = null; }
  const verified = Date.parse(details?.verifiedAt);
  const fresh = details && CHANNEL_ID.test(details.channelId) && typeof details.title === 'string' && details.title.trim() && details.scope === 'readonly' && Number.isFinite(verified) && verified > now - 30 * DAY && verified <= now + 60000;
  if (!fresh) return {...value,status:row.status === 'connected' ? 'stale' : row.status,details:null};
  return {...value,details:{channelId:details.channelId,title:details.title.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,160),thumbnailUrl:safeThumbnail(details.thumbnailUrl),url:`https://www.youtube.com/channel/${details.channelId}`,verifiedAt:new Date(verified).toISOString(),scope:'readonly'}};
}
