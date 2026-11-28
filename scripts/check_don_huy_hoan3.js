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
    const q = async (sql, p) => (await c.query(sql, p)).rows[0];
    console.log(
      'inserted_at 01/10-25/11',
      await q(
        `SELECT count(*) FILTER (WHERE trang_thai_ten='canceled')::int AS huy,
                count(*) FILTER (WHERE trang_thai_ten IN ('returned','part_returned'))::int AS hoan
         FROM global.fact_don_hang_moi_nhat
         WHERE nullif(btrim(inserted_at),'') IS NOT NULL
           AND (inserted_at::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
               BETWEEN '2026-10-01' AND '2026-11-25'`
      )
    );
    // POS đôi khi lọc “đã gửi hàng / thành công rồi hủy-trả” — thử loại đơn tiền 0
    console.log(
      'ngay + tien>0',
      await q(
        `SELECT count(*) FILTER (WHERE trang_thai_ten='canceled' AND coalesce(tong_sau_giam,0)>0)::int AS huy,
                count(*) FILTER (WHERE trang_thai_ten IN ('returned','part_returned'))::int AS hoan
         FROM global.fact_don_hang_moi_nhat
         WHERE ngay BETWEEN '2026-10-01' AND '2026-11-25'`
      )
    );
    // Chỉ Facebook+Tiktok (cửa hàng) — loại Shopify/IG vận đơn?
    console.log(
      'ngay + kenh FB/TT',
      await q(
        `SELECT count(*) FILTER (WHERE trang_thai_ten='canceled')::int AS huy,
                count(*) FILTER (WHERE trang_thai_ten IN ('returned','part_returned'))::int AS hoan
         FROM global.fact_don_hang_moi_nhat
         WHERE ngay BETWEEN '2026-10-01' AND '2026-11-25'
           AND kenh IN ('Facebook','Tiktok')`
      )
    );
    console.log(
      'ngay + khong shopify',
      await q(
        `SELECT count(*) FILTER (WHERE trang_thai_ten='canceled')::int AS huy,
                count(*) FILTER (WHERE trang_thai_ten IN ('returned','part_returned'))::int AS hoan
         FROM global.fact_don_hang_moi_nhat
         WHERE ngay BETWEEN '2026-10-01' AND '2026-11-25'
           AND coalesce(kenh,'') <> 'Shopify'`
      )
    );
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
