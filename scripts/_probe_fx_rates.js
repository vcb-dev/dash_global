/** Suy tỷ giá POS (analytics VND / tổng native) theo ngày×tiền tệ. */
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
  if (!res.ok) throw new Error(`${pathname} ${res.status}`);
  return res.json();
}

function toVnDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const WH = [
  '5d131d34-4d4e-49a4-beba-a59599eb3be1',
  '8b08cc6b-9c5e-4be1-af7f-ee6042842ac4',
  'd32f2d75-1cd8-4987-a960-ed69bfeae918',
];

(async () => {
  const days = ['2026-10-15', '2026-11-01', '2026-11-15', '2026-11-20', '2026-11-25'];
  const agg = {}; // cur -> {vnd, native, n}
  for (const day of days) {
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
    for (const whId of WH) {
      const row = (sale.data || []).find((r) => r['Order.warehouse_id'] === whId);
      const vnd = row?.result?.revenue || 0;
      if (!vnd) continue;
      let page = 1;
      let totalPages = 1;
      const byCur = {};
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
          const cur = String(o.order_currency || 'VND').toUpperCase();
          byCur[cur] = byCur[cur] || { n: 0, sum: 0 };
          byCur[cur].n += 1;
          byCur[cur].sum += Number(o.total_price_after_sub_discount) || 0;
        }
        page += 1;
      } while (page <= totalPages);
      const curs = Object.keys(byCur);
      if (curs.length === 1) {
        const cur = curs[0];
        agg[cur] = agg[cur] || { vnd: 0, native: 0, n: 0 };
        agg[cur].vnd += vnd;
        agg[cur].native += byCur[cur].sum;
        agg[cur].n += byCur[cur].n;
        console.log(day, whId.slice(0, 8), cur, 'rate', (vnd / byCur[cur].sum).toFixed(4), 'n', byCur[cur].n);
      } else {
        console.log(day, whId.slice(0, 8), 'mixed', byCur, 'vnd', vnd);
      }
    }
  }
  console.log('\nWEIGHTED RATES');
  for (const [cur, a] of Object.entries(agg)) {
    console.log(cur, { rate: a.native ? a.vnd / a.native : null, n: a.n, vnd: a.vnd, native: a.native });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
