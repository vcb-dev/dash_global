const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8')
  .split(/\r?\n/)
  .forEach((l) => {
    const m = l.match(/^\s*([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

(async () => {
  const c = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    for (const [a, b] of [
      ['2026-11-01', '2026-11-25'],
      ['2026-10-01', '2026-11-25'],
    ]) {
      const dt = await c.query(
        `SELECT coalesce(sum(don_chot),0)::float AS don_chot_fact_dt,
                coalesce(sum(so_luong),0)::float AS sl,
                coalesce(sum(order_revenue_vnd),0)::float AS doanh_thu
         FROM global.fact_doanh_thu_moi_nhat
         WHERE ngay BETWEEN $1 AND $2`,
        [a, b]
      );
      const oh = await c.query(
        `SELECT
           count(*) FILTER (WHERE trang_thai_ten IN ('delivered','shipped','received_money'))::int AS don_chot_oh,
           count(*) FILTER (WHERE trang_thai_ten IN ('delivered','shipped','received_money','part_returned'))::int AS chot_plus_part,
           count(DISTINCT order_id) FILTER (WHERE trang_thai_ten IN ('delivered','shipped','received_money'))::int AS distinct_chot
         FROM global.fact_don_hang_moi_nhat
         WHERE ngay BETWEEN $1 AND $2`,
        [a, b]
      );
      // Overview có thể loại DV?
      const dtEx = await c.query(
        `SELECT coalesce(sum(f.don_chot),0)::float AS don_chot
         FROM global.fact_doanh_thu_moi_nhat f
         LEFT JOIN global.dim_spu d ON d.spu_key = f.spu_key
         WHERE f.ngay BETWEEN $1 AND $2
           AND coalesce(d.phan_khuc,'') <> 'Dịch vụ/Đặt hàng'`,
        [a, b]
      );
      console.log(`\n${a} → ${b}`);
      console.log('fact_doanh_thu sum(don_chot)=', dt.rows[0].don_chot_fact_dt, 'excl DV=', dtEx.rows[0].don_chot);
      console.log('fact_don_hang', oh.rows[0]);
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
