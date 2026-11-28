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
  const day = '2026-10-07';
  const whId = '8b08cc6b-9c5e-4be1-af7f-ee6042842ac4';
  const sale = await apiGet('analytics/sale', {
    since: `${day}T00:00:00`,
    until: `${day}T23:59:59`,
    success_record: 'inserted_at',
    success_status: 0,
    returned_record: 'success_record',
    user_type: 'update',
    'select_fields[]': ['revenue', 'success_order_count'],
    'split_by[]': ['Order.warehouse_id'],
  });
  const row = (sale.data || []).find((r) => r['Order.warehouse_id'] === whId);
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
      rows.push({ id: o.id, cur: o.order_currency, amt: Number(o.total_price_after_sub_discount) || 0 });
    }
    page += 1;
  } while (page <= totalPages);
  const byCur = {};
  for (const r of rows) {
    byCur[r.cur] = byCur[r.cur] || { n: 0, sum: 0 };
    byCur[r.cur].n++;
    byCur[r.cur].sum += r.amt;
  }
  const jpy = byCur.JPY?.sum || 0;
  const usd = byCur.USD?.sum || 0;
  const vndA = row?.result?.revenue || 0;
  // assume JPY 159.09
  const jpyRate = 159.09;
  const residual = vndA - jpy * jpyRate;
  console.log({ byCur, analytics: row?.result, residual, usdRate: usd ? residual / usd : null });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
