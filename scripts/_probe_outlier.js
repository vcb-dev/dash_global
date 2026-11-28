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
const { Client } = require(path.join(__dirname, '..', 'be', 'node_modules', 'pg'));

(async () => {
  const c = new Client({
    connectionString: ENV.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const top = await c.query(`
    SELECT order_id, kho, ngay::text, trang_thai_ten, round(tong_sau_giam)::bigint AS vnd,
           ngay_xuat::text, ngay_thanh_cong::text
    FROM global.fact_don_hang_moi_nhat
    ORDER BY tong_sau_giam DESC NULLS LAST
    LIMIT 8`);
  console.log('top VND', top.rows);

  // Re-fetch those from POS to see native currency/amount
  for (const row of top.rows.slice(0, 3)) {
    const u = new URL(`https://pos.pages.fm/api/v1/shops/${ENV.PANCAKE_SHOP_ID}/orders/${row.order_id}`);
    // try search by id in list instead
  }

  // Pull one huge order from API by scanning Japan pages briefly isn't ideal;
  // use orders endpoint with system or id filter if any.
  const ids = top.rows.slice(0, 5).map((r) => r.order_id);
  for (const oid of ids) {
    const u = new URL(`https://pos.pages.fm/api/v1/shops/${ENV.PANCAKE_SHOP_ID}/orders`);
    u.searchParams.set('api_key', ENV.PANCAKE_API_KEY);
    u.searchParams.set('page_size', '1');
    u.searchParams.set('page_number', '1');
    u.searchParams.set('search', oid);
    const res = await fetch(u);
    const js = await res.json();
    const o = (js.data || []).find((x) => String(x.id) === String(oid)) || (js.data || [])[0];
    if (!o) {
      console.log('not found', oid);
      continue;
    }
    console.log({
      id: o.id,
      cur: o.order_currency,
      native: o.total_price_after_sub_discount,
      status: o.status_name,
      wh: o.warehouse_info?.name,
      db_vnd: top.rows.find((r) => String(r.order_id) === String(oid))?.vnd,
    });
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
