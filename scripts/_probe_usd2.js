const fs = require('fs');
const path = require('path');
function loadEnv(p) {
  const e = { ...process.env };
  if (!fs.existsSync(p)) return e;
  fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .forEach((l) => {
      const m = l.match(/^\s*([^#=]+)=(.*)$/);
      if (m && e[m[1].trim()] === undefined) e[m[1].trim()] = m[2].trim();
    });
  return e;
}
const ENV = {
  ...loadEnv(path.join(__dirname, '..', 'be', '.env')),
  ...loadEnv(path.join('D:', 'Cursor', 'Global', 'pancake', '.env')),
};

async function apiGet(pathname, params) {
  const u = new URL(`https://pos.pages.fm/api/v1/shops/${ENV.PANCAKE_SHOP_ID}/${pathname}`);
  u.searchParams.set('api_key', ENV.PANCAKE_API_KEY);
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.set(k, String(v));
  }
  const res = await fetch(u);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
function toVnDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

(async () => {
  const day = '2026-10-30';
  const whId = '5d131d34-4d4e-49a4-beba-a59599eb3be1';
  let page = 1;
  let totalPages = 1;
  const rows = [];
  do {
    const res = await apiGet('orders', {
      page_size: 100,
      page_number: page,
      warehouse_id: whId,
      start_date_time_iso: `${day}T00:00:00+07:00`,
      end_date_time_iso: `${day}T23:59:59+07:00`,
    });
    totalPages = res.total_pages || 1;
    for (const o of res.data || []) {
      if (toVnDate(o.inserted_at) !== day) continue;
      rows.push({
        id: o.id,
        cur: o.order_currency,
        amt: o.total_price_after_sub_discount,
        status: o.status_name,
        status_code: o.status,
      });
    }
    page += 1;
  } while (page <= totalPages);
  console.log('orders that day', rows);
  const byCur = {};
  for (const r of rows) {
    const c = r.cur || '?';
    byCur[c] = byCur[c] || { n: 0, sum: 0 };
    byCur[c].n++;
    byCur[c].sum += Number(r.amt) || 0;
  }
  console.log('byCur', byCur);

  // shop object search for rate tables
  const shop = (await apiGet('', {})).shop;
  const hits = [];
  const walk = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (/exchange|currency_rate|rates|ty_gia|multi_currency/i.test(k)) {
        hits.push([p, typeof v === 'object' ? JSON.stringify(v).slice(0, 400) : v]);
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && path.split('.').length < 4) walk(v, p);
      if (Array.isArray(v) && /curr|rate/i.test(k)) hits.push([p, JSON.stringify(v).slice(0, 400)]);
    }
  };
  walk(shop);
  console.log('shop rate hits', hits);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
