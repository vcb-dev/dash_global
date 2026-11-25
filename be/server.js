const http = require('http');
const crypto = require('crypto');
const { ENV } = require('./lib/db');
const auth = require('./lib/auth');
const queries = require('./lib/queries');

const PORT = Number(ENV.PORT || 3847);
const FE_ORIGINS = String(ENV.FE_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
const FE_ORIGIN = FE_ORIGINS[0];

function allowOrigin(origin) {
  if (!origin) return FE_ORIGIN;
  if (FE_ORIGINS.includes(origin)) return origin;
  if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return origin;
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith('.vercel.app')) return origin;
  } catch {
    /* ignore */
  }
  return FE_ORIGIN;
}

function corsHeaders(req) {
  const allow = allowOrigin(req.headers.origin);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function send(res, req, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8',
    ...corsHeaders(req),
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function qs(url) {
  const u = new URL(url, 'http://localhost');
  const out = {};
  u.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return { pathname: u.pathname, query: out };
}

const API_CACHE = new Map();
const API_CACHE_TTL = 20_000;

function apiCacheKey(pathname, query) {
  return `${pathname}|${query.from || ''}|${query.to || ''}|${query.kho || ''}|${query.phan_khuc || ''}|${query.phan_nhom || ''}|${query.key || ''}`;
}

async function cachedJson(pathname, query, fn) {
  const key = apiCacheKey(pathname, query);
  const hit = API_CACHE.get(key);
  if (hit && Date.now() - hit.at < API_CACHE_TTL) return hit.value;
  const value = await fn();
  API_CACHE.set(key, { at: Date.now(), value });
  if (API_CACHE.size > 80) API_CACHE.delete(API_CACHE.keys().next().value);
  return value;
}

async function handleApi(req, res, pathname, query) {
  if (pathname === '/api/me') {
    const user = auth.getUser(req);
    return send(res, req, 200, {
      user: user || null,
      authenticated: !!user,
      passwordLogin: auth.passwordAuthEnabled(),
      google: auth.googleEnabled(),
      devLogin: auth.devLoginEnabled(),
    });
  }

  if (auth.authRequired() && !auth.getUser(req)) {
    return send(res, req, 401, { error: 'unauthorized' });
  }

  const map = {
    '/api/overview': () => queries.overview(query),
    '/api/san-pham': () => queries.sanPham(query),
    '/api/ton-kho': () => queries.tonKho(query),
    '/api/hang-dang-ve': () => queries.hangDangVe(query),
    '/api/hanh-dong': () => queries.hanhDong(query),
    '/api/spu-check': () => queries.spuCheck(query),
    '/api/filters': () => queries.filterOptions(),
  };
  const fn = map[pathname];
  if (!fn) return send(res, req, 404, { error: 'not found' });
  const body = pathname === '/api/spu-check' ? await fn() : await cachedJson(pathname, query, fn);
  return send(res, req, 200, body, { 'Cache-Control': 'private, max-age=15' });
}

async function handleAuth(req, res, pathname, query) {
  if (pathname === '/auth/login' && req.method === 'POST') {
    if (!auth.passwordAuthEnabled()) {
      return send(res, req, 400, { error: 'Password login chưa cấu hình (AUTH_USERS)' });
    }
    const raw = await readBody(req);
    let username = '';
    let password = '';
    try {
      const body = JSON.parse(raw || '{}');
      username = body.username || body.email || '';
      password = body.password || '';
    } catch {
      return send(res, req, 400, { error: 'Invalid JSON' });
    }
    const user = auth.verifyPasswordLogin(username, password);
    if (!user) return send(res, req, 401, { error: 'Sai tài khoản hoặc mật khẩu' });
    auth.setSession(res, user);
    return send(res, req, 200, {
      ok: true,
      user: { email: user.email, name: user.name, username: user.username },
    });
  }

  if (pathname === '/auth/google') {
    if (!auth.googleEnabled()) return send(res, req, 400, { error: 'Google OAuth chưa cấu hình' });
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader(
      'Set-Cookie',
      `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    );
    res.writeHead(302, { Location: auth.googleAuthUrl(state), ...corsHeaders(req) });
    return res.end();
  }

  if (pathname === '/auth/google/callback') {
    try {
      const cookies = auth.parseCookies(req);
      if (!query.state || query.state !== cookies.oauth_state) {
        return send(res, req, 400, 'Invalid state');
      }
      const user = await auth.exchangeGoogleCode(query.code);
      if (!auth.isAllowed(user.email)) {
        return send(res, req, 403, `Email ${user.email} không nằm trong ALLOWED_EMAILS`);
      }
      auth.setSession(res, user);
      res.writeHead(302, { Location: FE_ORIGIN + '/', ...corsHeaders(req) });
      return res.end();
    } catch (e) {
      return send(res, req, 500, String(e.message || e));
    }
  }

  if (pathname === '/auth/dev-login' && req.method === 'POST') {
    if (!auth.devLoginEnabled()) return send(res, req, 403, { error: 'dev login off' });
    const raw = await readBody(req);
    let email = 'dev@local';
    try {
      email = JSON.parse(raw).email || email;
    } catch {
      /* ignore */
    }
    if (!auth.isAllowed(email) && (ENV.ALLOWED_EMAILS || '').trim()) {
      return send(res, req, 403, { error: 'email not allowed' });
    }
    auth.setSession(res, { email, name: 'Dev User', picture: '' });
    return send(res, req, 200, { ok: true });
  }

  if (pathname === '/auth/logout' && (req.method === 'POST' || req.method === 'GET')) {
    auth.clearSession(res);
    if (req.method === 'GET') {
      res.writeHead(302, { Location: FE_ORIGIN + '/', ...corsHeaders(req) });
      return res.end();
    }
    return send(res, req, 200, { ok: true });
  }

  return send(res, req, 404, { error: 'auth not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    const { pathname, query } = qs(req.url || '/');

    if (pathname === '/' || pathname === '/health') {
      return send(res, req, 200, { ok: true, service: 'dash-global-be' });
    }

    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, query);
    if (pathname.startsWith('/auth/')) return await handleAuth(req, res, pathname, query);

    return send(res, req, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, req, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`BE API → http://localhost:${PORT}`);
  console.log(`CORS FE_ORIGIN: ${FE_ORIGIN}`);
  console.log(`Schema: ${ENV.DB_SCHEMA || 'global'}`);
  console.log(`Password login: ${auth.passwordAuthEnabled() ? 'on' : 'off'}`);
});
