import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly'
].join(' ');

app.get('/api/oauth/google/connect', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/google/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: String(req.query.service || req.query.scope || 'unified')
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).json({ ok: false, error });
  res.redirect(`/?connected=google&service=${encodeURIComponent(state || 'unified')}&code=${code ? 'received' : 'missing'}`);
});

app.get('/api/oauth/meta/connect', (req, res) => {
  const base = 'https://' + 'www.facebook.com' + '/v20.0/dialog/oauth';
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID || '',
    redirect_uri: process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/meta/callback`,
    scope: 'pages_show_list,instagram_basic,whatsapp_business_management',
    response_type: 'code',
    state: String(req.query.service || 'meta')
  });
  res.redirect(`${base}?${params.toString()}`);
});

app.get('/api/oauth/tiktok/connect', (req, res) => {
  const base = 'https://' + 'www.tiktok.com' + '/v2/auth/authorize/';
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY || '',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/tiktok/callback`,
    response_type: 'code',
    scope: 'user.info.basic,video.list'
  });
  res.redirect(`${base}?${params.toString()}`);
});

app.get('/api/oauth/snapchat/connect', (req, res) => {
  const base = 'https://' + 'accounts.snapchat.com' + '/login/oauth2/authorize';
  const params = new URLSearchParams({
    client_id: process.env.SNAPCHAT_CLIENT_ID || '',
    redirect_uri: process.env.SNAPCHAT_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/snapchat/callback`,
    response_type: 'code',
    scope: 'snapchat-marketing-api'
  });
  res.redirect(`${base}?${params.toString()}`);
});

app.get('/api/oauth/x/connect', (req, res) => {
  const base = 'https://' + 'twitter.com' + '/i/oauth2/authorize';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID || '',
    redirect_uri: process.env.X_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/x/callback`,
    scope: 'tweet.read tweet.write users.read offline.access',
    state: 'x_oauth',
    code_challenge: 'challenge',
    code_challenge_method: 'plain'
  });
  res.redirect(`${base}?${params.toString()}`);
});

app.listen(PORT, () => {
  console.log(`Taswiqat Cloud server running on port ${PORT}`);
});
