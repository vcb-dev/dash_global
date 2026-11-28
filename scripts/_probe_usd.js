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
  // Find USD orders and their days
  const whs = [
    '5d131d34-4d4e-49a4-beba-a59599eb3be1',
    '8b08cc6b-9c5e-4be1-af7f-ee6042842ac4',
  ];
  const usdOrders = [];
  for (const whId of whs) {
    let page = 1;
    let totalPages = 1;
    do {
      const res = await apiGet('orders', {
        page_size: 100,
        page_number: page,
        warehouse_id: whId,
        start_date_time_iso: '2026-09-01T00:00:00+07:00',
        end_date_time_iso: '2026-11-28T23:59:59+07:00',
      });
      totalPages = res.total_pages || 1;
      for (const o of res.data || []) {
        if (String(o.order_currency || '').toUpperCase() !== 'USD') continue;
        usdOrders.push({
          id: o.id,
          whId,
          ngay: toVnDate(o.inserted_at),
          amt: Number(o.total_price_after_sub_discount) || 0,
          status: o.status_name,
        });
      }
      page += 1;
    } while (page <= totalPages);
  }
  console.log('USD orders', usdOrders);

  for (const o of usdOrders) {
    if (!o.ngay) continue;
    const sale = await apiGet('analytics/sale', {
      since: `${o.ngay}T00:00:00`,
      until: `${o.ngay}T23:59:59`,
      success_record: 'inserted_at',
      success_status: 0,
      returned_record: 'success_record',
      user_type: 'update',
      'select_fields[]': ['revenue', 'success_order_count'],
      'split_by[]': ['Order.warehouse_id'],
    });
    const row = (sale.data || []).find((r) => r['Order.warehouse_id'] === o.whId);
    console.log({
      id: o.id,
      ngay: o.ngay,
      usd: o.amt,
      analytics_vnd: row?.result?.revenue,
      analytics_don: row?.result?.success_order_count,
    });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
