const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export function apiOrigin() {
  return API_BASE || window.location.origin;
}

export async function getJson(path) {
  const res = await fetch(`${apiOrigin()}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function api(path, filters = {}) {
  const u = new URL(path, apiOrigin() + '/');
  if (filters.from) u.searchParams.set('from', filters.from);
  if (filters.to) u.searchParams.set('to', filters.to);
  if (filters.kho && filters.kho !== 'All') u.searchParams.set('kho', filters.kho);
  if (filters.phan_khuc && filters.phan_khuc !== 'All') u.searchParams.set('phan_khuc', filters.phan_khuc);
  if (filters.phan_nhom && filters.phan_nhom !== 'All') u.searchParams.set('phan_nhom', filters.phan_nhom);
  const res = await fetch(u.toString(), { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
