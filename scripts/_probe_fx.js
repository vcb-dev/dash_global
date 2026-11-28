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

(async () => {
  const shop = (await apiGet('', {})).shop;
  const found = [];
  JSON.stringify(shop, (k, v) => {
    if (/curr|rate|exch|jpy|thb|vnd/i.test(String(k))) {
      found.push([k, typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v]);
    }
    return v;
  });
  console.log('shop fx-ish fields:', found);

  // Reverse-engineer rate: Japan orders 2026-11-20 vs analytics revenue
  const day = '2026-11-20';
  const whId = '5d131d34-4d4e-49a4-beba-a59599eb3be1'; // JP VAT
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
  const jpSale = (sale.data || []).find((r) => r['Order.warehouse_id'] === whId);
  console.log('analytics JP', jpSale?.result);

  let page = 1;
  let totalPages = 1;
  let sumJpy = 0;
  let n = 0;
  const curs = {};
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
      const cur = o.order_currency || '?';
      curs[cur] = (curs[cur] || 0) + 1;
      sumJpy += Number(o.total_price_after_sub_discount) || 0;
      n += 1;
    }
    page += 1;
  } while (page <= totalPages);
  console.log({ n, sumJpy, curs, vnd: jpSale?.result?.revenue, rate: jpSale?.result?.revenue / sumJpy });

  // Thai same day
  const thaiId = 'd32f2d75-1cd8-4987-a960-ed69bfeae918';
  const thSale = (sale.data || []).find((r) => r['Order.warehouse_id'] === thaiId);
  page = 1;
  totalPages = 1;
  let sumThb = 0;
  let nTh = 0;
  const cursTh = {};
  do {
    const res = await apiGet('orders', {
      page_size: 100,
      page_number: page,
      warehouse_id: thaiId,
      start_date_time_iso: `${day}T00:00:00+07:00`,
      end_date_time_iso: `${day}T23:59:59+07:00`,
    });
    totalPages = res.total_pages || 1;
    for (const o of res.data || []) {
      const cur = o.order_currency || '?';
      cursTh[cur] = (cursTh[cur] || 0) + 1;
      sumThb += Number(o.total_price_after_sub_discount) || 0;
      nTh += 1;
    }
    page += 1;
  } while (page <= totalPages);
  console.log({
    thai: { nTh, sumThb, cursTh, vnd: thSale?.result?.revenue, rate: thSale?.result?.revenue / sumThb },
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
