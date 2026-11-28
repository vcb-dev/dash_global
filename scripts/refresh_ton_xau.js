// Chạy riêng: siết phân khúc + chốt snapshot tồn xấu + (tuỳ chọn) ép chốt mới.
//   node refresh_ton_xau.js           → refresh theo lịch 15 ngày
//   node refresh_ton_xau.js --force   → ép chốt snapshot hôm nay (ngày tồn mới nhất)
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
const { refreshDimSpuPhanKhuc, refreshSnapshotTonXau, pruneDimSpuInactive } = require('./load_supabase');

const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const force = process.argv.includes('--force');

(async () => {
  const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await refreshDimSpuPhanKhuc(client);
    await pruneDimSpuInactive(client);
    await refreshDimSpuPhanKhuc(client);
    await refreshSnapshotTonXau(client, { force });
    const SCHEMA = process.env.DB_SCHEMA || env.DB_SCHEMA || 'global';
    const pk = await client.query(
      `SELECT phan_khuc, count(*)::int n FROM "${SCHEMA}"."dim_spu" WHERE phan_khuc IS NOT NULL GROUP BY 1 ORDER BY 1`
    );
    console.log('phan_khuc:', pk.rows.map((r) => `${r.phan_khuc}=${r.n}`).join(', '));
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
