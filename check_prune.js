const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const SCHEMA = env.DB_SCHEMA || 'global';
const fq = (t) => `"${SCHEMA}"."${t}"`;
(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const chot = await c.query(`SELECT max(ngay)::text AS d FROM ${fq('fact_ton_kho_moi_nhat')}`);
  console.log('ngày chốt tồn:', chot.rows[0].d);

  const orphan = await c.query(`
    WITH ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}),
    ban30 AS (
      SELECT f.spu_key, sum(f.so_luong) sl
      FROM ${fq('fact_doanh_thu_moi_nhat')} f, ref
      WHERE f.ngay BETWEEN ref.ngay_chot - 29 AND ref.ngay_chot
      GROUP BY f.spu_key
      HAVING sum(f.so_luong) <> 0 OR sum(f.don_chot) <> 0 OR sum(f.order_revenue_vnd) <> 0
    ),
    ton AS (
      SELECT t.spu_key, sum(t.inventory_qty) qty
      FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
      WHERE t.ngay = ref.ngay_chot
      GROUP BY t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    )
    SELECT d.spu_key, d.phan_khuc, d.sl_30_ngay,
           coalesce(b.sl,0) AS ban_30d,
           coalesce(t.qty,0) AS ton_cuoi
    FROM ${fq('dim_spu')} d
    LEFT JOIN ban30 b ON b.spu_key = d.spu_key
    LEFT JOIN ton t ON t.spu_key = d.spu_key
    WHERE b.spu_key IS NULL AND t.spu_key IS NULL
    ORDER BY d.spu_key
    LIMIT 50`);
  console.log('Còn trong dim nhưng 30d không bán + hết tồn:', orphan.rows.length);
  orphan.rows.forEach((r) => console.log(`  ${r.spu_key} | ${r.phan_khuc} | sl30=${r.sl_30_ngay} ban=${r.ban_30d} ton=${r.ton_cuoi}`));

  const tonXau = await c.query(`
    SELECT count(*)::int n, coalesce(sum(CASE WHEN coalesce(sl_30_ngay,0)=0 THEN 1 ELSE 0 END),0)::int zero30
    FROM ${fq('dim_spu')} WHERE phan_khuc = 'Tồn xấu'`);
  console.log('Tồn xấu trong dim:', tonXau.rows[0].n, '| trong đó sl_30=0:', tonXau.rows[0].zero30);

  // Why Tồn xấu kept: must have stock
  const tonXauTon = await c.query(`
    WITH ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}),
    ton AS (
      SELECT t.spu_key, sum(t.inventory_qty) qty
      FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
      WHERE t.ngay = ref.ngay_chot GROUP BY t.spu_key
    )
    SELECT count(*) FILTER (WHERE coalesce(t.qty,0) <> 0)::int co_ton,
           count(*) FILTER (WHERE coalesce(t.qty,0) = 0)::int het_ton
    FROM ${fq('dim_spu')} d
    LEFT JOIN ton t ON t.spu_key = d.spu_key
    WHERE d.phan_khuc = 'Tồn xấu'`);
  console.log('Tồn xấu: còn tồn=', tonXauTon.rows[0].co_ton, '| hết tồn=', tonXauTon.rows[0].het_ton);

  const total = await c.query(`SELECT count(*)::int n FROM ${fq('dim_spu')}`);
  console.log('dim_spu tổng=', total.rows[0].n);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
