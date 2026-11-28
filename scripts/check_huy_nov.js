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
    // Mọi trạng thái có chữ cancel / return / hoàn?
    const st = await c.query(`
      SELECT trang_thai, trang_thai_ten, count(*)::int n
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN '2026-11-01' AND '2026-11-25'
      GROUP BY 1,2 ORDER BY n DESC`);
    console.log('statuses Nov by ngay');
    console.table(st.rows);

    // Hủy: so sánh ngay vs inserted_at
    const cmp = await c.query(`
      SELECT order_id, ngay::text AS ngay,
             left(coalesce(inserted_at,''), 19) AS inserted_at,
             kho, trang_thai_ten, tong_sau_giam::float AS tien
      FROM global.fact_don_hang_moi_nhat
      WHERE trang_thai_ten = 'canceled'
        AND (
          ngay BETWEEN '2026-11-01' AND '2026-11-25'
          OR (
            nullif(btrim(inserted_at),'') IS NOT NULL
            AND (inserted_at::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                BETWEEN '2026-11-01' AND '2026-11-25'
          )
        )
      ORDER BY ngay, order_id`);
    console.log('canceled overlapping Nov (ngay OR inserted)');
    console.table(cmp.rows);

    // Toàn bộ canceled trong DB (mọi ngày) — có đơn Nov bị thiếu không
    const allHuy = await c.query(`
      SELECT count(*)::int n,
             min(ngay)::text AS min_d,
             max(ngay)::text AS max_d
      FROM global.fact_don_hang_moi_nhat
      WHERE trang_thai_ten = 'canceled'`);
    console.log('all canceled in moi_nhat', allHuy.rows[0]);

    // returned Nov
    const hoan = await c.query(`
      SELECT trang_thai_ten, count(*)::int n
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN '2026-11-01' AND '2026-11-25'
        AND trang_thai_ten IN ('returned','returning','part_returned')
      GROUP BY 1`);
    console.log('hoan Nov');
    console.table(hoan.rows);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
