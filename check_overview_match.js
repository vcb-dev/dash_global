const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const S = 'global';
const fq = (t) => `"${S}"."${t}"`;

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const from = '2026-11-01';
  const to = '2026-11-19';

  const tables = await c.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema=$1 AND (table_name LIKE '%po%' OR table_name LIKE '%doanh%')
    ORDER BY 1`, [S]);
  console.log('tables', tables.rows.map((r) => r.table_name));

  for (const view of ['fact_doanh_thu_moi_nhat', 'fact_doanh_thu']) {
    try {
      const r = await c.query(`
        SELECT sum(order_revenue_vnd)::float dt, sum(don_chot)::float don, sum(so_luong)::float sl,
               count(DISTINCT spu_key)::int spu
        FROM ${fq(view)}
        WHERE ngay BETWEEN $1::date AND $2::date`, [from, to]);
      console.log(view, r.rows[0]);
    } catch (e) {
      console.log(view, e.message);
    }
  }

  // SL exclude trung gian / dich vu
  const slEx = await c.query(`
    SELECT sum(f.so_luong)::float sl, sum(f.order_revenue_vnd)::float dt, sum(f.don_chot)::float don,
           count(DISTINCT f.spu_key)::int spu
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN $1::date AND $2::date
      AND coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')`, [from, to]);
  console.log('DT exclude TG/DV', slEx.rows[0]);

  // Số SPU trên dim
  const spu = await c.query(`
    SELECT count(*)::int all_spu,
           count(*) FILTER (WHERE phan_khuc IS NOT NULL)::int co_pk,
           count(*) FILTER (WHERE phan_khuc NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng'))::int ban_hang
    FROM ${fq('dim_spu')}`);
  console.log('dim_spu', spu.rows[0]);

  // SPU có bán trong kỳ
  const spuBan = await c.query(`
    SELECT count(DISTINCT f.spu_key)::int
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    WHERE f.ngay BETWEEN $1::date AND $2::date AND coalesce(f.so_luong,0)<>0`, [from, to]);
  console.log('spu co SL>0', spuBan.rows[0]);

  for (const view of ['fact_po_moi_nhat', 'fact_po']) {
    try {
      const r = await c.query(`
        SELECT count(DISTINCT ma_po)::int so_po,
               sum(so_luong_con_thieu)::float dang_ve,
               sum(so_luong_con_thieu) FILTER (WHERE han_giao < CURRENT_DATE)::float qua_han_today,
               sum(so_luong_con_thieu) FILTER (WHERE han_giao < $1::date)::float qua_han_to,
               count(*)::int rows
        FROM ${fq(view)}
        WHERE coalesce(so_luong_con_thieu,0) > 0`, [to]);
      console.log(view, r.rows[0]);
    } catch (e) {
      console.log(view, e.message);
    }
  }

  // donut ma cu moi
  const ma = await c.query(`
    SELECT coalesce(d.ma_cu_moi,'(không rõ)') ma, sum(f.order_revenue_vnd)::float dt
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN $1::date AND $2::date
    GROUP BY 1 ORDER BY dt DESC`, [from, to]);
  console.log('ma_cu_moi', ma.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
