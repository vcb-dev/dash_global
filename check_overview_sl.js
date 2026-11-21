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

  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='dim_spu' ORDER BY 1`,
    [S]
  );
  console.log('dim_spu cols', cols.rows.map((r) => r.column_name));

  const spu = await c.query(`
    SELECT count(*)::int all_spu,
           count(*) FILTER (WHERE phan_khuc IS NOT NULL)::int co_pk,
           count(*) FILTER (WHERE coalesce(phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng'))::int ban_hang
    FROM ${fq('dim_spu')}`);
  console.log('dim_spu', spu.rows[0]);

  const byPk = await c.query(`
    SELECT coalesce(d.phan_khuc,'(null)') pk,
           sum(f.so_luong)::float sl,
           sum(f.order_revenue_vnd)::float dt,
           sum(f.don_chot)::float don
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN $1::date AND $2::date
    GROUP BY 1 ORDER BY sl DESC NULLS LAST`, [from, to]);
  console.log('by pk', byPk.rows);

  const byKho = await c.query(`
    SELECT kho,
           sum(order_revenue_vnd)::float dt,
           sum(so_luong)::float sl,
           sum(don_chot)::float don
    FROM ${fq('fact_doanh_thu_moi_nhat')}
    WHERE ngay BETWEEN $1::date AND $2::date
    GROUP BY 1`, [from, to]);
  console.log('by kho', byKho.rows);

  // try SL that equals 707
  const trials = await c.query(`
    SELECT
      sum(f.so_luong)::float sl_all,
      sum(f.so_luong) FILTER (WHERE coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng'))::float sl_ex_tg_dv,
      sum(f.so_luong) FILTER (WHERE coalesce(d.phan_khuc,'') <> 'Mã trung gian')::float sl_ex_tg,
      sum(f.so_luong) FILTER (WHERE coalesce(d.phan_khuc,'') <> 'Dịch vụ/Đặt hàng')::float sl_ex_dv,
      sum(f.so_luong) FILTER (WHERE coalesce(f.order_revenue_vnd,0) <> 0)::float sl_dt_nz,
      sum(f.so_luong) FILTER (WHERE coalesce(f.don_chot,0) <> 0)::float sl_don_nz
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN $1::date AND $2::date`, [from, to]);
  console.log('sl trials', trials.rows[0]);

  // DT trung gian
  const tg = await c.query(`
    SELECT sum(f.order_revenue_vnd)::float dt
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN $1::date AND $2::date AND d.phan_khuc = 'Mã trung gian'`, [from, to]);
  console.log('DT TG', tg.rows[0]);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
