const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const memory = new Map();

export function apiOrigin() {
  return API_BASE || window.location.origin;
}

export function filtersKey(filters = {}) {
  return [
    filters.from,
    filters.to,
    filters.kho,
    filters.phan_khuc,
    filters.phan_nhom,
    filters.ma_cu_moi,
    filters.spu,
    filters.ngay_snapshot,
    filters.trang_thai_day,
    filters.flag_eta,
    filters.trang_thai,
  ].join('|');
}

export async function getJson(path, opts = {}) {
  const res = await fetch(`${apiOrigin()}${path}`, { credentials: 'include', signal: opts.signal });
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.code = 401;
    throw err;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function api(path, filters = {}, opts = {}) {
  const u = new URL(path, apiOrigin() + '/');
  if (filters.from) u.searchParams.set('from', filters.from);
  if (filters.to) u.searchParams.set('to', filters.to);
  if (filters.kho && filters.kho !== 'All') u.searchParams.set('kho', filters.kho);
  if (filters.phan_khuc && filters.phan_khuc !== 'All') u.searchParams.set('phan_khuc', filters.phan_khuc);
  if (filters.phan_nhom && filters.phan_nhom !== 'All') u.searchParams.set('phan_nhom', filters.phan_nhom);
  if (filters.ma_cu_moi && filters.ma_cu_moi !== 'All') u.searchParams.set('ma_cu_moi', filters.ma_cu_moi);
  if (filters.spu && filters.spu !== 'All') u.searchParams.set('spu', filters.spu);
  if (filters.ngay_snapshot) u.searchParams.set('ngay_snapshot', filters.ngay_snapshot);
  if (filters.trang_thai_day && filters.trang_thai_day !== 'All') {
    u.searchParams.set('trang_thai_day', filters.trang_thai_day);
  }
  if (filters.flag_eta && filters.flag_eta !== 'All') u.searchParams.set('flag_eta', filters.flag_eta);
  if (filters.trang_thai && filters.trang_thai !== 'All') u.searchParams.set('trang_thai', filters.trang_thai);

  // Allow path already containing query (e.g. /api/spu-check?key=)
  if (path.includes('?')) {
    const [base, qs] = path.split('?');
    u.pathname = new URL(base, apiOrigin() + '/').pathname;
    new URLSearchParams(qs).forEach((v, k) => u.searchParams.set(k, v));
  }

  const key = u.toString();
  if (!opts.skipCache && memory.has(key)) return memory.get(key);
  const res = await fetch(key, { credentials: 'include', signal: opts.signal });
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.code = 401;
    throw err;
  }
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  memory.set(key, json);
  if (memory.size > 40) memory.delete(memory.keys().next().value);
  return json;
}

export function clearApiCache() {
  memory.clear();
}
