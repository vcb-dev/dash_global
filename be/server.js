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

const GUEST = { email: 'local', name: 'Pancake BI', picture: '' };

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

async function handleApi(req, res, pathname, query) {
  if (pathname === '/api/me') {
    return send(res, req, 200, {
      user: auth.getUser(req) || GUEST,
      google: false,
      devLogin: false,
    });
  }

  if (pathname === '/api/overview') {
    return send(res, req, 200, await queries.overview(query));
  }
  if (pathname === '/api/san-pham') {
    return send(res, req, 200, await queries.sanPham(query));
  }
  if (pathname === '/api/ton-kho') {
    return send(res, req, 200, await queries.tonKho(query));
  }
  if (pathname === '/api/hang-dang-ve') {
    return send(res, req, 200, await queries.hangDangVe(query));
  }
  if (pathname === '/api/hanh-dong') {
    return send(res, req, 200, await queries.hanhDong(query));
  }
  if (pathname === '/api/spu-check') {
    return send(res, req, 200, await queries.spuCheck(query));
  }
  if (pathname === '/api/filters') {
    return send(res, req, 200, await queries.filterOptions());
  }

  return send(res, req, 404, { error: 'not found' });
}

async function handleAuth(req, res, pathname, query) {
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

  if (pathname === '/auth/logout') {
    auth.clearSession(res);
    res.writeHead(302, { Location: FE_ORIGIN + '/', ...corsHeaders(req) });
    return res.end();
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
});
