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
    const a = '2026-10-01';
    const b = '2026-11-25';

    // Thái only — khớp screenshot cũ 9 hủy / 35 trả?
    const thai = await c.query(
      `
      SELECT
        count(*) FILTER (WHERE trang_thai_ten = 'canceled')::int AS huy,
        count(*) FILTER (WHERE trang_thai_ten IN ('returned','returning','part_returned'))::int AS hoan,
        count(*) FILTER (WHERE trang_thai_ten IN ('delivered','shipped','received_money'))::int AS chot
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN $1 AND $2 AND kho = 'KHO THÁI LAN'`,
      [a, b]
    );
    console.log('Thái 01/10-25/11', thai.rows[0]);

    // Chỉ returned (không part) + canceled
    const strict = await c.query(
      `
      SELECT
        count(*) FILTER (WHERE trang_thai_ten = 'canceled')::int AS huy,
        count(*) FILTER (WHERE trang_thai_ten = 'returned')::int AS hoan_returned_only,
        count(*) FILTER (WHERE trang_thai_ten IN ('returned','part_returned'))::int AS hoan_ca_part
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN $1 AND $2`,
      [a, b]
    );
    console.log('All kho strict', strict.rows[0]);

    // Có trùng order_id?
    const dup = await c.query(
      `
      SELECT order_id, count(*)::int n
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN $1 AND $2 AND trang_thai_ten IN ('canceled','returned','part_returned')
      GROUP BY 1 HAVING count(*) > 1
      LIMIT 10`,
      [a, b]
    );
    console.log('dup order_id', dup.rows);

    // Hủy theo tháng
    const byMonth = await c.query(
      `
      SELECT to_char(ngay,'YYYY-MM') AS thang, trang_thai_ten, count(*)::int n
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN $1 AND $2
        AND trang_thai_ten IN ('canceled','returned','part_returned')
      GROUP BY 1,2 ORDER BY 1,2`,
      [a, b]
    );
    console.table(byMonth.rows);

    // List canceled — xem tong_tien = 0 nhiều không
    const huy = await c.query(
      `
      SELECT order_id, ngay::text, kho, nv_ban, tong_sau_giam::float AS tien, kenh
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN $1 AND $2 AND trang_thai_ten = 'canceled'
      ORDER BY ngay, order_id`,
      [a, b]
    );
    console.log('canceled detail count', huy.rows.length);
    console.table(huy.rows);

    // returned list count
    const hoan = await c.query(
      `
      SELECT trang_thai_ten, count(*)::int n,
             count(*) FILTER (WHERE coalesce(tong_sau_giam,0)=0)::int AS tien0
      FROM global.fact_don_hang_moi_nhat
      WHERE ngay BETWEEN $1 AND $2
        AND trang_thai_ten IN ('returned','part_returned','returning')
      GROUP BY 1`,
      [a, b]
    );
    console.table(hoan.rows);

    // Nếu POS đếm theo inserted_at?
    const cols = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='global' AND table_name='fact_don_hang'
        AND column_name ILIKE '%insert%' OR (table_schema='global' AND table_name='fact_don_hang' AND column_name ILIKE '%update%')
      ORDER BY 1`);
    console.log('date-ish cols', cols.rows);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
