const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const SCHEMA = env.DB_SCHEMA || 'global';
const fq = (t) => `"${SCHEMA}"."${t}"`;

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='dim_spu' ORDER BY ordinal_position`,
    [SCHEMA]
  );
  console.log('dim_spu cols:', cols.rows.map((r) => r.column_name).join(', '));

  const ngay = await c.query(`SELECT min(ngay)::text AS min_n, max(ngay)::text AS max_n FROM ${fq('fact_ton_kho_moi_nhat')}`);
  console.log('tồn range:', ngay.rows[0]);

  const ngayTao = await c.query(
    `SELECT count(*)::int AS n, count(ngay_tao_ma)::int AS co_ngay_tao FROM ${fq('dim_spu')}`
  );
  console.log('dim_spu ngày tạo mã:', ngayTao.rows[0]);

  const firstImp = await c.query(`
    WITH fi AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty,0) <> 0) AS first_import
      FROM ${fq('fact_ton_kho_moi_nhat')}
      GROUP BY spu_key
    ),
    ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')})
    SELECT
      count(*) FILTER (WHERE d.phan_khuc = 'Tồn xấu')::int AS ton_xau,
      count(*) FILTER (
        WHERE d.phan_khuc = 'Tồn xấu'
          AND fi.first_import IS NOT NULL
          AND fi.first_import >= (SELECT ngay_chot - 29 FROM ref)
      )::int AS ton_xau_moi_nhap_30d,
      count(*) FILTER (
        WHERE d.phan_khuc = 'Tồn xấu'
          AND d.ngay_tao_ma IS NOT NULL
          AND d.ngay_tao_ma >= (SELECT ngay_chot - 29 FROM ref)
      )::int AS ton_xau_tao_ma_30d
    FROM ${fq('dim_spu')} d
    LEFT JOIN fi ON fi.spu_key = d.spu_key`);
  console.log('Tồn xấu vs hàng mới:', firstImp.rows[0]);

  const po = await c.query(`
    SELECT count(*)::int n, coalesce(sum(so_luong_con_thieu),0)::float thieu
    FROM ${fq('fact_po_moi_nhat')} WHERE coalesce(so_luong_con_thieu,0) <> 0`);
  console.log('PO còn thiếu:', po.rows[0]);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
