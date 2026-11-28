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
  if (!res.ok) throw new Error(`${pathname} ${res.status} ${await res.text()}`);
  return res.json();
}

function toVnDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

(async () => {
  const day = '2026-11-20';
  const whs = [
    { id: '5d131d34-4d4e-49a4-beba-a59599eb3be1', name: 'JP VAT' },
    { id: 'd32f2d75-1cd8-4987-a960-ed69bfeae918', name: 'THAI' },
  ];

  const sale = await apiGet('analytics/sale', {
    since: `${day}T00:00:00`,
    until: `${day}T23:59:59`,
    success_record: 'inserted_at',
    success_status: 0,
    returned_record: 'success_record',
    user_type: 'update',
    'select_fields[]': ['revenue', 'success_order_count', 'price'],
    'split_by[]': ['Order.warehouse_id'],
  });

  for (const w of whs) {
    const row = (sale.data || []).find((r) => r['Order.warehouse_id'] === w.id);
    let page = 1;
    let totalPages = 1;
    let sum = 0;
    let n = 0;
    const byCur = {};
    const samples = [];
    do {
      const res = await apiGet('orders', {
        page_size: 100,
        page_number: page,
        warehouse_id: w.id,
        start_date_time_iso: `${day}T00:00:00+07:00`,
        end_date_time_iso: `${day}T23:59:59+07:00`,
      });
      totalPages = res.total_pages || 1;
      for (const o of res.data || []) {
        const ngay = toVnDate(o.inserted_at);
        if (ngay !== day) continue; // chỉ đơn chốt đúng ngày
        const cur = o.order_currency || '?';
        const amt = Number(o.total_price_after_sub_discount) || 0;
        byCur[cur] = byCur[cur] || { n: 0, sum: 0 };
        byCur[cur].n += 1;
        byCur[cur].sum += amt;
        sum += amt;
        n += 1;
        if (samples.length < 3) {
          samples.push({
            id: o.id,
            cur,
            amt,
            status: o.status_name,
            keys: Object.keys(o).filter((k) => /rate|curr|vnd|price|total/i.test(k)),
          });
        }
      }
      page += 1;
    } while (page <= totalPages);

    const vnd = row?.result?.revenue || 0;
    console.log('\n===', w.name, day);
    console.log({
      analytics_don: row?.result?.success_order_count,
      analytics_vnd: vnd,
      orders_n: n,
      orders_sum_native: sum,
      byCur,
      implied_rate: n ? vnd / sum : null,
      samples,
    });
  }

  // Peek one Japan order for any rate field nested
  const one = await apiGet('orders', {
    page_size: 5,
    page_number: 1,
    warehouse_id: whs[0].id,
    start_date_time_iso: `${day}T00:00:00+07:00`,
    end_date_time_iso: `${day}T23:59:59+07:00`,
  });
  const o = (one.data || []).find((x) => toVnDate(x.inserted_at) === day) || (one.data || [])[0];
  if (o) {
    const deep = [];
    JSON.stringify(o, (k, v) => {
      if (/rate|curr|exchange|vnd|jpy|thb/i.test(String(k))) deep.push([k, v]);
      return v;
    });
    console.log('\norder deep fx fields', deep);
    console.log('item0 variation_info keys', o.items?.[0] ? Object.keys(o.items[0].variation_info || {}) : null);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
