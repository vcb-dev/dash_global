const crypto = require('crypto');
const { ENV } = require('./db');

const SECRET = ENV.SESSION_SECRET || 'pancake-dev-secret-change-me';
const ALLOWED = (ENV.ALLOWED_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** AUTH_USERS=admin:pass|viewer:pass2 */
function parseAuthUsers() {
  return String(ENV.AUTH_USERS || '')
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      if (i <= 0) return null;
      return {
        username: pair.slice(0, i).trim(),
        password: pair.slice(i + 1),
      };
    })
    .filter((u) => u && u.username && u.password);
}

function passwordAuthEnabled() {
  return parseAuthUsers().length > 0;
}

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyPasswordLogin(username, password) {
  const users = parseAuthUsers();
  const u = users.find((x) => safeEqualStr(x.username, String(username || '').trim()));
  if (!u) return null;
  if (!safeEqualStr(u.password, String(password || ''))) return null;
  return {
    email: u.username,
    name: u.username,
    picture: '',
    username: u.username,
  };
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expect) return null;
  try {
    const json = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (json.exp && Date.now() > json.exp) return null;
    return json;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function getUser(req) {
  const cookies = parseCookies(req);
  return verify(cookies.session);
}

function cookieSecure() {
  // Cross-site FE (Vercel) → BE (Railway) needs SameSite=None; Secure
  const fe = String(ENV.FE_ORIGIN || '');
  return /https:\/\//i.test(fe) || ENV.COOKIE_SECURE === '1';
}

function sessionCookie(value, maxAge) {
  const parts = [`session=${value}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAge}`];
  if (cookieSecure()) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function setSession(res, user) {
  const token = sign({
    email: user.email || user.username,
    name: user.name || user.username || user.email,
    picture: user.picture || '',
    username: user.username || user.email,
    exp: Date.now() + 7 * 24 * 3600 * 1000,
  });
  res.setHeader('Set-Cookie', sessionCookie(token, 7 * 24 * 3600));
}

function clearSession(res) {
  res.setHeader('Set-Cookie', sessionCookie('', 0));
}

function isAllowed(email) {
  if (!ALLOWED.length) return true;
  return ALLOWED.includes(String(email || '').toLowerCase());
}

function googleEnabled() {
  return !!(ENV.GOOGLE_CLIENT_ID && ENV.GOOGLE_CLIENT_SECRET);
}

function googleAuthUrl(state) {
  const redirect = ENV.GOOGLE_REDIRECT_URI || 'http://localhost:3847/auth/google/callback';
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', ENV.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('access_type', 'online');
  u.searchParams.set('prompt', 'select_account');
  u.searchParams.set('state', state);
  return u.toString();
}

async function exchangeGoogleCode(code) {
  const redirect = ENV.GOOGLE_REDIRECT_URI || 'http://localhost:3847/auth/google/callback';
  const body = new URLSearchParams({
    code,
    client_id: ENV.GOOGLE_CLIENT_ID,
    client_secret: ENV.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error(tok.error_description || 'Google token failed');
  const meRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const me = await meRes.json();
  if (!me.email) throw new Error('No email from Google');
  return { email: me.email, name: me.name || me.email, picture: me.picture || '' };
}

/** Dev login when Google not configured and password auth off */
function devLoginEnabled() {
  if (passwordAuthEnabled()) return false;
  return ENV.ALLOW_DEV_LOGIN === '1' || !googleEnabled();
}

/** Require login for API when password users or Google is configured */
function authRequired() {
  return passwordAuthEnabled() || googleEnabled() || ENV.REQUIRE_AUTH === '1';
}

module.exports = {
  getUser,
  setSession,
  clearSession,
  isAllowed,
  googleEnabled,
  googleAuthUrl,
  exchangeGoogleCode,
  devLoginEnabled,
  parseCookies,
  passwordAuthEnabled,
  verifyPasswordLogin,
  authRequired,
};
