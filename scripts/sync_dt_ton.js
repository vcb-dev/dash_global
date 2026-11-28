/**
 * Kéo POS analytics/sale + inventory → fact_doanh_thu / fact_ton_kho (schema global).
 * Giữ cửa sổ moi_nhat bằng cách copy batch cũ rồi gắn ngày mới (mặc định đến 26/11).
 *
 * Usage:
 *   node scripts/sync_dt_ton.js
 *   node scripts/sync_dt_ton.js 2026-10-01 2026-11-26
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'be', 'node_modules', 'pg'));

function loadEnv(p) {
  const env = { ...process.env };
  if (!fs.existsSync(p)) return env;
  fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .forEach((l) => {
      const m = l.match(/^\s*([^#=]+)=(.*)$/);
      if (m && env[m[1].trim()] === undefined) env[m[1].trim()] = m[2].trim();
    });
  return env;
}

const ENV = {
  ...loadEnv(path.join(__dirname, '..', 'be', '.env')),
  ...loadEnv(path.join('D:', 'Cursor', 'Global', 'pancake', '.env')),
};
const SCHEMA = ENV.DB_SCHEMA || 'global';
const API_KEY = ENV.PANCAKE_API_KEY;
const SHOP_ID = ENV.PANCAKE_SHOP_ID;
const BASE = `https://pos.pages.fm/api/v1/shops/${SHOP_ID}`;
const fq = (t) => `"${SCHEMA}"."${t}"`;

/** Nhật chỉ lấy CÓ VAT — không kéo KHÔNG VAT / tên cũ. */
const KHO_MAP = {
  'KHO THÁI LAN': 'KHO THÁI LAN',
  'KHO NHẬT BẢN CÓ VAT': 'KHO NHẬT BẢN',
};
const WANTED = new Set(Object.keys(KHO_MAP));

function todayVn() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
}

function shiftYmd(ymd, days) {
  const d = new Date(`${ymd}T12:00:00+07:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
}

function spuKey(spuGoc, sku) {
  let x = String(spuGoc || '')
    .trim()
    .trimEnd(',')
    .toUpperCase();
  if (!x) {
    x = String(sku || '')
      .trim()
      .trimEnd(',')
      .toUpperCase();
  }
  if (!x) return null;
  if (x.includes('|')) x = x.split('|')[0].trim();
  let prefix = '';
  const tl = x.match(/^TL-\s*(.+)$/);
  if (tl) {
    prefix = 'TL-';
    x = tl[1].trim();
  }
  if (x.includes('-')) x = x.split('-')[0].trim();
  return prefix + x;
}

function getSize(variation) {
  const fields = Array.isArray(variation?.fields) ? variation.fields : [];
  const hit = fields.find((f) => /^(size|kích thước|kich thuoc)$/i.test(String(f.name || '').trim()));
  return hit?.value != null ? String(hit.value) : null;
}

async function apiGet(pathname, params) {
  const u = new URL(`${BASE}/${pathname}`);
  u.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
    else u.searchParams.set(k, String(v));
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json();
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

function unixVnDay(ymd) {
  const start = Math.floor(new Date(`${ymd}T00:00:00+07:00`).getTime() / 1000);
  const end = Math.floor(new Date(`${ymd}T23:59:59+07:00`).getTime() / 1000);
  return { start, end };
}

async function insertBatch(client, table, cols, rows) {
  if (!rows.length) return 0;
  const batch = Math.max(1, Math.floor(20000 / cols.length));
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const params = [];
    const values = chunk.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(',')})`;
    });
    await client.query(
      `INSERT INTO ${fq(table)} (${cols.map((c) => `"${c}"`).join(',')})
       VALUES ${values.join(',')}
       ON CONFLICT DO NOTHING`,
      params
    );
    n += chunk.length;
  }
  return n;
}

async function main() {
  if (!API_KEY || !SHOP_ID) throw new Error('Thiếu PANCAKE_API_KEY / PANCAKE_SHOP_ID');
  if (!ENV.SUPABASE_DB_URL) throw new Error('Thiếu SUPABASE_DB_URL');

  const from = process.argv[2] || '2026-10-01';
  const to = process.argv[3] || '2026-11-26';
  if (to > todayVn()) throw new Error(`to=${to} vượt hôm nay VN ${todayVn()}`);
  console.log(`Sync DT+tồn ${from} → ${to} (schema=${SCHEMA})`);

  const whRes = await apiGet('warehouses', {});
  const warehouses = (whRes.data || []).filter((w) => WANTED.has(String(w.name || '').trim()));
  const whById = {};
  for (const w of warehouses) {
    const raw = String(w.name || '').trim();
    whById[w.id] = KHO_MAP[raw] || raw;
  }
  console.log('warehouses', Object.values(whById).join(', '));

  // --- DT (analytics/sale) ---
  console.log('Fetching analytics/sale...');
  const since = `${from}T00:00:00`;
  const until = `${to}T23:59:59`;
  const saleBase = {
    since,
    until,
    success_record: 'inserted_at',
    success_status: 0,
    returned_record: 'success_record',
    user_type: 'update',
    'select_fields[]': ['success_order_count', 'revenue', 'product_count'],
  };
  const saleKho = await apiGet('analytics/sale', {
    ...saleBase,
    'split_by[]': ['Time.day', 'Order.warehouse_id'],
  });
  const donTheoKho = new Map();
  for (const r of saleKho.data || []) {
    const whId = r['Order.warehouse_id'];
    const day = r['Time.day'];
    if (!day || !whById[whId]) continue;
    donTheoKho.set(`${day}|${whById[whId]}`, Number(r.result?.success_order_count) || 0);
  }

  const sale = await apiGet('analytics/sale', {
    ...saleBase,
    'split_by[]': ['Time.day', 'Order.warehouse_id', 'Variation.id'],
  });
  const revenue = [];
  const seenDon = new Set();
  for (const r of sale.data || []) {
    const whId = r['Order.warehouse_id'];
    const day = r['Time.day'];
    if (!day || !whById[whId]) continue;
    if (day < from || day > to) continue;
    const v = r.variation || {};
    let key = spuKey(v.product?.custom_id, v.custom_id);
    if (!key) {
      if (!(Number(r.result?.revenue) || Number(r.result?.product_count))) continue;
      key = 'KHONG_XAC_DINH';
    }
    const kho = whById[whId];
    const dk = `${day}|${kho}`;
    let don = 0;
    if (!seenDon.has(dk)) {
      don = donTheoKho.get(dk) || 0;
      seenDon.add(dk);
    }
    revenue.push({
      ngay: day,
      kho,
      sku: v.custom_id ? String(v.custom_id).trim().replace(/,+$/, '') : key,
      spu_key: key,
      size: getSize(v),
      don_chot: don,
      so_luong: Number(r.result?.product_count) || 0,
      order_revenue_vnd: Number(r.result?.revenue) || 0,
      revenue_truoc_hoan: Number(r.success?.revenue) || 0,
      doanh_thu_hoan: r.returned ? Number(r.returned.revenue) || 0 : 0,
    });
  }
  console.log(
    `fact_doanh_thu rows=${revenue.length} don=${revenue.reduce((s, r) => s + r.don_chot, 0)} dt=${revenue.reduce((s, r) => s + r.order_revenue_vnd, 0)}`
  );

  // --- Tồn: copy batch cũ < to, kéo từng ngày còn thiếu đến `to` ---
  const client = new Client({
    connectionString: ENV.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const lanTai = new Date().toISOString();

  try {
    const prevTon = (
      await client.query(
        `SELECT max(lan_tai) AS lan FROM ${fq('lich_su_nap')} WHERE bang = 'fact_ton_kho'`
      )
    ).rows[0]?.lan;

    const tonMaxPrev = prevTon
      ? (
          await client.query(
            `SELECT max(ngay)::text AS m FROM ${fq('fact_ton_kho')} WHERE lan_tai = $1`,
            [prevTon]
          )
        ).rows[0]?.m
      : null;

    const tonRows = [];
    if (prevTon) {
      const copied = await client.query(
        `
        SELECT ngay::text AS ngay, kho, sku, spu_key, size,
               begin_qty, import_qty, sell_export_qty, inventory_qty, inventory_value
        FROM ${fq('fact_ton_kho')}
        WHERE lan_tai = $1 AND ngay >= $2::date AND ngay < $3::date`,
        [prevTon, from, to]
      );
      for (const r of copied.rows) tonRows.push(r);
      console.log(`Copied ton rows from prev batch (<${to}): ${copied.rows.length} (prev max ${tonMaxPrev})`);
    }

    // Kéo các ngày còn thiếu: từ max(prev+1, from) → to
    let pullFrom = from;
    if (tonMaxPrev && tonMaxPrev >= from) pullFrom = shiftYmd(tonMaxPrev, 1);
    if (pullFrom > to) {
      console.log('Tồn đã đủ đến', to);
    } else {
      console.log(`Pull inventory ${pullFrom} → ${to}`);
      for (let day = pullFrom; day <= to; day = shiftYmd(day, 1)) {
        const { start, end } = unixVnDay(day);
        for (const w of warehouses) {
          let page = 1;
          let totalPages = 1;
          do {
            const res = await apiGet('inventory_analytics/inventory', {
              start_date: start,
              end_date: end,
              type: 'actual',
              'warehouse_ids[]': w.id,
              page,
              page_size: 2000,
            });
            totalPages = Number(res.total_pages) || 1;
            for (const d of res.data || []) {
              if (
                !(Number(d.end_inventory) || Number(d.begin_inventory) || Number(d.total_import) || Number(d.total_export))
              ) {
                continue;
              }
              const v = d.variation || {};
              const key = spuKey(v.product?.custom_id, v.custom_id) || 'KHONG_XAC_DINH';
              tonRows.push({
                ngay: day,
                kho: KHO_MAP[String(w.name || '').trim()] || String(w.name || '').trim(),
                sku: String(v.custom_id || '')
                  .trim()
                  .replace(/,+$/, ''),
                spu_key: key,
                size: getSize(v),
                begin_qty: Number(d.begin_inventory) || 0,
                import_qty: Number(d.total_import) || 0,
                sell_export_qty: -1 * (Number(d.sell_export) || 0),
                inventory_qty: Number(d.end_inventory) || 0,
                inventory_value: Number(d.end_inventory_value) || 0,
              });
            }
            page += 1;
          } while (page <= totalPages);
        }
        process.stdout.write(`\r  ton ${day} rows=${tonRows.length}   `);
      }
      console.log('');
    }

    // Insert DT
    const dtCols = [
      'lan_tai',
      'ngay',
      'kho',
      'sku',
      'spu_key',
      'size',
      'don_chot',
      'so_luong',
      'order_revenue_vnd',
      'revenue_truoc_hoan',
      'doanh_thu_hoan',
    ];
    const dtInsert = revenue.map((r) => [
      lanTai,
      r.ngay,
      r.kho,
      r.sku,
      r.spu_key,
      r.size,
      r.don_chot,
      r.so_luong,
      r.order_revenue_vnd,
      r.revenue_truoc_hoan,
      r.doanh_thu_hoan,
    ]);
    const nDt = await insertBatch(client, 'fact_doanh_thu', dtCols, dtInsert);
    await client.query(
      `INSERT INTO ${fq('lich_su_nap')} (lan_tai, bang, tu_ngay, den_ngay, file, so_dong)
       VALUES ($1,'fact_doanh_thu',$2::date,$3::date,'sync_dt_ton.js',$4)`,
      [lanTai, from, to, nDt]
    );

    const tonCols = [
      'lan_tai',
      'ngay',
      'kho',
      'sku',
      'spu_key',
      'size',
      'begin_qty',
      'import_qty',
      'sell_export_qty',
      'inventory_qty',
      'inventory_value',
    ];
    const tonInsert = tonRows.map((r) => [
      lanTai,
      r.ngay,
      r.kho,
      r.sku,
      r.spu_key,
      r.size,
      r.begin_qty,
      r.import_qty,
      r.sell_export_qty,
      r.inventory_qty,
      r.inventory_value,
    ]);
    const nTon = await insertBatch(client, 'fact_ton_kho', tonCols, tonInsert);
    await client.query(
      `INSERT INTO ${fq('lich_su_nap')} (lan_tai, bang, tu_ngay, den_ngay, file, so_dong)
       VALUES ($1,'fact_ton_kho',$2::date,$3::date,'sync_dt_ton.js',$4)`,
      [lanTai, from, to, nTon]
    );

    const check = await client.query(`
      SELECT
        (SELECT max(ngay)::text FROM ${fq('fact_doanh_thu_moi_nhat')}) AS max_dt,
        (SELECT max(ngay)::text FROM ${fq('fact_ton_kho_moi_nhat')}) AS max_ton,
        (SELECT count(*)::int FROM ${fq('fact_doanh_thu_moi_nhat')} WHERE ngay = $1::date) AS dt_to,
        (SELECT count(*)::int FROM ${fq('fact_ton_kho_moi_nhat')} WHERE ngay = $1::date) AS ton_to
    `, [to]);
    console.log('OK moi_nhat', check.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
