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
    const ranges = [
      ['2026-11-01', '2026-11-24'],
      ['2026-11-01', '2026-11-25'],
      ['2026-10-01', '2026-11-25'],
    ];
    for (const [a, b] of ranges) {
      const r = await c.query(
        `
        SELECT
          count(*)::int AS all_orders,
          count(*) FILTER (WHERE trang_thai_ten = 'canceled')::int AS canceled,
          count(*) FILTER (WHERE trang_thai_ten IN ('returned','returning','part_returned'))::int AS return_group,
          count(*) FILTER (WHERE trang_thai_ten = 'returned')::int AS returned,
          count(*) FILTER (WHERE trang_thai_ten = 'returning')::int AS returning,
          count(*) FILTER (WHERE trang_thai_ten = 'part_returned')::int AS part_returned,
          count(*) FILTER (WHERE trang_thai_ten IN ('delivered','shipped','received_money'))::int AS chot
        FROM global.fact_don_hang_moi_nhat
        WHERE ngay BETWEEN $1::date AND $2::date`,
        [a, b]
      );
      console.log(`\n=== ${a} → ${b} ===`);
      console.table(r.rows);

      const byStatus = await c.query(
        `
        SELECT trang_thai_ten, count(*)::int n
        FROM global.fact_don_hang_moi_nhat
        WHERE ngay BETWEEN $1::date AND $2::date
        GROUP BY 1 ORDER BY n DESC`,
        [a, b]
      );
      console.table(byStatus.rows);

      const byKho = await c.query(
        `
        SELECT kho,
          count(*) FILTER (WHERE trang_thai_ten = 'canceled')::int AS huy,
          count(*) FILTER (WHERE trang_thai_ten IN ('returned','returning','part_returned'))::int AS hoan
        FROM global.fact_don_hang_moi_nhat
        WHERE ngay BETWEEN $1::date AND $2::date
        GROUP BY 1 ORDER BY 1`,
        [a, b]
      );
      console.table(byKho.rows);
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
