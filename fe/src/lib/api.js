const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const memory = new Map();

export function apiOrigin() {
  return API_BASE || window.location.origin;
}

export function filtersKey(filters = {}) {
  return [filters.from, filters.to, filters.kho, filters.phan_khuc, filters.phan_nhom].join('|');
}

export async function getJson(path, opts = {}) {
  const res = await fetch(`${apiOrigin()}${path}`, { credentials: 'include', signal: opts.signal });
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
  const key = u.toString();
  if (!opts.skipCache && memory.has(key)) return memory.get(key);
  const res = await fetch(key, { credentials: 'include', signal: opts.signal });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  memory.set(key, json);
  if (memory.size > 40) memory.delete(memory.keys().next().value);
  return json;
}
