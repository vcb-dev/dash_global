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
  const u = new URL(`https://pos.pages.fm/api/v1/shops/${ENV.PANCAKE_SHOP_ID}/warehouses`);
  u.searchParams.set('api_key', ENV.PANCAKE_API_KEY);
  const wh = await (await fetch(u)).json();
  console.log(
    'ALL WH:',
    (wh.data || []).map((w) => ({ id: w.id, name: w.name }))
  );

  const c = new Client({
    connectionString: ENV.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(`
    SELECT count(*)::int n,
      count(ngay_xuat)::int co_xuat,
      count(ngay_thanh_cong)::int co_tc,
      count(*) FILTER (WHERE ngay_xuat BETWEEN '2026-11-01' AND '2026-11-28')::int xuat_t11,
      count(*) FILTER (WHERE ngay_thanh_cong BETWEEN '2026-11-01' AND '2026-11-28')::int tc_t11,
      coalesce(sum(tong_sau_giam) FILTER (WHERE ngay_xuat BETWEEN '2026-11-01' AND '2026-11-28'),0)::float dt_xuat_t11,
      coalesce(sum(tong_sau_giam) FILTER (WHERE ngay_thanh_cong BETWEEN '2026-11-01' AND '2026-11-28'),0)::float dt_tc_t11
    FROM global.fact_don_hang_moi_nhat`);
  console.log('view', r.rows[0]);
  const k = await c.query(
    `SELECT kho, count(*)::int n FROM global.fact_don_hang_moi_nhat GROUP BY 1 ORDER BY 1`
  );
  console.log('by kho', k.rows);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
