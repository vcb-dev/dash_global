const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ENV } = require('./lib/db');
const auth = require('./lib/auth');
const queries = require('./lib/queries');

const PORT = Number(ENV.PORT || 3847);
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8',
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

const GUEST = { email: 'local', name: 'Pancake BI', picture: '' };

async function handleApi(req, res, pathname, query) {
  if (pathname === '/api/me') {
    return send(res, 200, {
      user: auth.getUser(req) || GUEST,
      google: false,
      devLogin: false,
    });
  }

  if (pathname === '/api/overview') {
    return send(res, 200, await queries.overview(query));
  }
  if (pathname === '/api/san-pham') {
    return send(res, 200, await queries.sanPham(query));
  }
  if (pathname === '/api/ton-kho') {
    return send(res, 200, await queries.tonKho(query));
  }
  if (pathname === '/api/hang-dang-ve') {
    return send(res, 200, await queries.hangDangVe(query));
  }
  if (pathname === '/api/hanh-dong') {
    return send(res, 200, await queries.hanhDong(query));
  }
  if (pathname === '/api/spu-check') {
    return send(res, 200, await queries.spuCheck(query));
  }
  if (pathname === '/api/filters') {
    return send(res, 200, await queries.filterOptions());
  }

  return send(res, 404, { error: 'not found' });
}

async function handleAuth(req, res, pathname, query) {
  if (pathname === '/auth/google') {
    if (!auth.googleEnabled()) return send(res, 400, { error: 'Google OAuth chưa cấu hình' });
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader(
      'Set-Cookie',
      `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    );
    res.writeHead(302, { Location: auth.googleAuthUrl(state) });
    return res.end();
  }

  if (pathname === '/auth/google/callback') {
    try {
      const cookies = auth.parseCookies(req);
      if (!query.state || query.state !== cookies.oauth_state) {
        return send(res, 400, 'Invalid state');
      }
      const user = await auth.exchangeGoogleCode(query.code);
      if (!auth.isAllowed(user.email)) {
        return send(res, 403, `Email ${user.email} không nằm trong ALLOWED_EMAILS`);
      }
      auth.setSession(res, user);
      res.writeHead(302, { Location: '/' });
      return res.end();
    } catch (e) {
      return send(res, 500, String(e.message || e));
    }
  }

  if (pathname === '/auth/dev-login' && req.method === 'POST') {
    if (!auth.devLoginEnabled()) return send(res, 403, { error: 'dev login off' });
    const raw = await readBody(req);
    let email = 'dev@local';
    try {
      email = JSON.parse(raw).email || email;
    } catch {
      /* ignore */
    }
    if (!auth.isAllowed(email) && (ENV.ALLOWED_EMAILS || '').trim()) {
      return send(res, 403, { error: 'email not allowed' });
    }
    auth.setSession(res, { email, name: 'Dev User', picture: '' });
    return send(res, 200, { ok: true });
  }

  if (pathname === '/auth/logout') {
    auth.clearSession(res);
    res.writeHead(302, { Location: '/' });
    return res.end();
  }

  return send(res, 404, { error: 'auth not found' });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  if (filePath === '/login') filePath = '/login.html';
  const full = path.normalize(path.join(PUBLIC, filePath));
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return send(res, 404, 'Not found');
  }
  const ext = path.extname(full);
  send(res, 200, fs.readFileSync(full), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname, query } = qs(req.url || '/');

    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, query);
    if (pathname.startsWith('/auth/')) return await handleAuth(req, res, pathname, query);

    // Không dùng trang đăng nhập — login.html → dashboard
    if (pathname === '/login.html' || pathname === '/login') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`Pancake BI Web → http://localhost:${PORT} (không cần đăng nhập)`);
  console.log(`Schema: ${ENV.DB_SCHEMA || 'global'}`);
});
