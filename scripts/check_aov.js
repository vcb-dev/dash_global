const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

function fmt(n) {
  return Math.round(n).toLocaleString('vi-VN');
}

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(`
    SELECT kho,
           sum(order_revenue_vnd)::float AS dt,
           sum(don_chot)::float AS don,
           sum(so_luong)::float AS sl,
           CASE WHEN sum(don_chot) = 0 THEN NULL
                ELSE sum(order_revenue_vnd) / sum(don_chot) END AS tb_don
    FROM global.fact_doanh_thu_moi_nhat
    WHERE ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'
    GROUP BY kho
    ORDER BY kho`);
  const t = await c.query(`
    SELECT sum(order_revenue_vnd)::float AS dt,
           sum(don_chot)::float AS don,
           CASE WHEN sum(don_chot) = 0 THEN NULL
                ELSE sum(order_revenue_vnd) / sum(don_chot) END AS tb_don
    FROM global.fact_doanh_thu_moi_nhat
    WHERE ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'`);
  for (const row of r.rows) {
    const tb = Number(row.tb_don);
    console.log(
      `${row.kho}: DT ${fmt(row.dt)} | đơn ${fmt(row.don)} | SL ${fmt(row.sl)} | TB/đơn ${fmt(tb)} (${tb.toFixed(0)}đ)`
    );
  }
  const tbAll = Number(t.rows[0].tb_don);
  console.log(
    `TỔNG: DT ${fmt(t.rows[0].dt)} | đơn ${fmt(t.rows[0].don)} | TB/đơn ${fmt(tbAll)} (${tbAll.toFixed(0)}đ)`
  );
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
