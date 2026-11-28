const { fq, withDb, parseRange, SYNC_RANGE_MIN } = require('./db');

/** Mã loại khỏi Tổng SPU (thủ công) — hiện trong danh sách bỏ */
const SPU_BO_THU_CONG = ['C500391'];

function pushParams(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function sqlInList(params, values) {
  if (!values.length) return null;
  return values.map((v) => pushParams(params, v)).join(', ');
}

function isBoThuCong(spuKey) {
  return SPU_BO_THU_CONG.includes(String(spuKey || '').toUpperCase());
}

/** Kho + phân khúc + phân nhóm + mã cũ/mới + SPU. Trả join/where gắn vào fact alias.
 *  opts.skipKho = true khi bảng không có cột kho (vd. fact_po). */
function factFilters(q, params, alias = 'f', dimAlias = 'dfl', opts = {}) {
  let join = '';
  let where = '';
  if (!opts.skipKho && q.kho && q.kho !== 'All') {
    where += ` AND ${alias}.kho = ${pushParams(params, q.kho)}`;
  }
  if (q.spu && q.spu !== 'All') {
    where += ` AND ${alias}.spu_key = ${pushParams(params, q.spu)}`;
  }
  const needPk = q.phan_khuc && q.phan_khuc !== 'All';
  const needNhom = q.phan_nhom && q.phan_nhom !== 'All';
  const needMa = q.ma_cu_moi && q.ma_cu_moi !== 'All';
  if (needPk || needNhom || needMa) {
    join = ` JOIN ${fq('dim_spu')} ${dimAlias} ON ${dimAlias}.spu_key = ${alias}.spu_key`;
    if (needPk) where += ` AND ${dimAlias}.phan_khuc = ${pushParams(params, q.phan_khuc)}`;
    if (needNhom) where += ` AND ${dimAlias}.chung_loai = ${pushParams(params, q.phan_nhom)}`;
    if (needMa) {
      where += ` AND coalesce(nullif(btrim(${dimAlias}.ma_cu_moi),''),'Mã cũ') = ${pushParams(params, q.ma_cu_moi)}`;
    }
  }
  return { join, where };
}

function dimWhere(q, params, alias = 'd') {
  let where = '';
  if (q.phan_khuc && q.phan_khuc !== 'All') {
    where += ` AND ${alias}.phan_khuc = ${pushParams(params, q.phan_khuc)}`;
  }
  if (q.phan_nhom && q.phan_nhom !== 'All') {
    where += ` AND ${alias}.chung_loai = ${pushParams(params, q.phan_nhom)}`;
  }
  if (q.ma_cu_moi && q.ma_cu_moi !== 'All') {
    where += ` AND coalesce(nullif(btrim(${alias}.ma_cu_moi),''),'Mã cũ') = ${pushParams(params, q.ma_cu_moi)}`;
  }
  if (q.spu && q.spu !== 'All') {
    where += ` AND ${alias}.spu_key = ${pushParams(params, q.spu)}`;
  }
  return where;
}

/**
 * Tổng SPU active theo kỳ filter: có bán trong [from,to] HOẶC còn tồn ngày chốt trong kỳ.
 * Không dùng cờ dim_spu.active (dễ lệch khi nạp thêm tháng — vd. 206 thay vì ~190 cho 1–20/11).
 */
function spuActiveTrongKy(params, from, to, alias = 'd', kho) {
  const pFrom = pushParams(params, from);
  const pTo = pushParams(params, to);
  let khoBan = '';
  let khoTon = '';
  let khoTonMax = '';
  if (kho && kho !== 'All') {
    const k = pushParams(params, kho);
    khoBan = ` AND f.kho = ${k}`;
    khoTon = ` AND t.kho = ${k}`;
    khoTonMax = ` AND t2.kho = ${k}`;
  }
  return `
    AND (
      EXISTS (
        SELECT 1 FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.spu_key = ${alias}.spu_key
          AND f.ngay BETWEEN ${pFrom}::date AND ${pTo}::date
          ${khoBan}
          AND (
            coalesce(f.so_luong,0) <> 0
            OR coalesce(f.don_chot,0) <> 0
            OR coalesce(f.order_revenue_vnd,0) <> 0
          )
      )
      OR EXISTS (
        SELECT 1 FROM ${fq('fact_ton_kho_moi_nhat')} t
        WHERE t.spu_key = ${alias}.spu_key
          ${khoTon}
          AND t.ngay = (
            SELECT max(t2.ngay) FROM ${fq('fact_ton_kho_moi_nhat')} t2
            WHERE t2.ngay BETWEEN ${pFrom}::date AND ${pTo}::date ${khoTonMax}
          )
          AND coalesce(t.inventory_qty,0) <> 0
      )
    )`;
}

/** Loại Dịch vụ/Đặt hàng khỏi Doanh thu tổng (Mã trung gian vẫn giữ). */
function notDichVuDt(alias = 'd') {
  return ` AND coalesce(${alias}.phan_khuc,'') <> 'Dịch vụ/Đặt hàng'
           AND coalesce(${alias}.loai_tru_doanh_thu, false) = false`;
}

/** Join dim nếu chưa có — dùng cho KPI doanh thu tổng. */
function ensureDimJoin(ff, factAlias = 'f', dimAlias = 'dfl') {
  if (ff.join) return { join: ff.join, dim: dimAlias };
  return {
    join: ` LEFT JOIN ${fq('dim_spu')} ${dimAlias} ON ${dimAlias}.spu_key = ${factAlias}.spu_key`,
    dim: dimAlias,
  };
}

function prevRange(from, to) {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const days = Math.round((b - a) / 86400000) + 1;
  const prevTo = new Date(a);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { prevFrom: iso(prevFrom), prevTo: iso(prevTo), days };
}

async function filterOptions() {
  return withDb(async (c) => {
    const pk = (
      await c.query(
        `SELECT DISTINCT phan_khuc AS v FROM ${fq('dim_spu')}
         WHERE phan_khuc IS NOT NULL AND btrim(phan_khuc) <> ''
         ORDER BY 1`
      )
    ).rows.map((r) => r.v);
    const nhom = (
      await c.query(
        `SELECT DISTINCT chung_loai AS v FROM ${fq('dim_spu')}
         WHERE chung_loai IS NOT NULL AND btrim(chung_loai) <> ''
         ORDER BY 1`
      )
    ).rows.map((r) => r.v);

    // Phễu so sánh được khi mọi trục cùng cửa sổ đã kéo:
    // chốt=DT, xuất=ngay_xuat, TC=ngay_thanh_cong (+ tồn cho trang khác).
    // max = LEAST(max từng nguồn) — không lấy đơn POS vượt DT/tồn.
    const rangeRow = (
      await c.query(
        `
      SELECT
        (SELECT min(ngay)::text FROM ${fq('fact_doanh_thu_moi_nhat')}) AS min_dt,
        (SELECT max(ngay)::text FROM ${fq('fact_doanh_thu_moi_nhat')}) AS max_dt,
        (SELECT min(ngay)::text FROM ${fq('fact_ton_kho_moi_nhat')}) AS min_ton,
        (SELECT max(ngay)::text FROM ${fq('fact_ton_kho_moi_nhat')}) AS max_ton,
        (SELECT max(ngay_xuat)::text FROM ${fq('fact_don_hang_moi_nhat')}) AS max_xuat,
        (SELECT max(ngay_thanh_cong)::text FROM ${fq('fact_don_hang_moi_nhat')}) AS max_tc,
        (SELECT array_agg(d::text ORDER BY d) FROM (
           SELECT DISTINCT ngay::date AS d FROM ${fq('fact_doanh_thu_moi_nhat')}
           WHERE ngay >= $1::date
         ) x) AS dt_days`,
        [SYNC_RANGE_MIN]
      )
    ).rows[0];

    const todayVn = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
    const candidates = [rangeRow?.max_dt, rangeRow?.max_ton, rangeRow?.max_xuat, rangeRow?.max_tc].filter(
      Boolean
    );
    let dateMax = candidates.length ? candidates.reduce((a, b) => (a < b ? a : b)) : null;
    if (dateMax && dateMax > todayVn) dateMax = todayVn;

    const minCandidates = [rangeRow?.min_dt, rangeRow?.min_ton].filter(Boolean);
    let dateMin = minCandidates.length
      ? minCandidates.reduce((a, b) => (a > b ? a : b))
      : SYNC_RANGE_MIN;
    if (dateMin < SYNC_RANGE_MIN) dateMin = SYNC_RANGE_MIN;
    if (dateMax && dateMin > dateMax) dateMin = dateMax;

    const dataDays = (rangeRow?.dt_days || []).filter(
      (d) => d >= dateMin && d <= (dateMax || todayVn)
    );

    return {
      kho: ['KHO NHẬT BẢN', 'KHO THÁI LAN'],
      phan_khuc: pk,
      phan_nhom: nhom,
      sync_from: dateMin,
      data_as_of: dateMax,
      date_bounds: dateMax
        ? { min: dateMin, max: dateMax }
        : { min: dateMin, max: todayVn },
      data_days: dataDays,
      axis_max: {
        dt: rangeRow?.max_dt || null,
        ton: rangeRow?.max_ton || null,
        xuat: rangeRow?.max_xuat || null,
        thanh_cong: rangeRow?.max_tc || null,
      },
    };
  });
}

async function overview(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const p = [from, to];
    const ff = factFilters(q, p, 'f');
    const dimKpi = ensureDimJoin(ff);

    const kpi = (
      await c.query(
        `
      SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt,
             coalesce(sum(f.don_chot),0)::float AS don,
             coalesce(sum(f.so_luong),0)::float AS sl
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${dimKpi.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}
        ${notDichVuDt(dimKpi.dim)}`,
        p
      )
    ).rows[0];

    // Tổng SPU = mã active TRONG KỲ (bán hoặc còn tồn cuối kỳ), bỏ TG/DV + thủ công.
    const spuP = [];
    const spuDim = dimWhere(q, spuP, 'd');
    const spuActive = spuActiveTrongKy(spuP, from, to, 'd', q.kho);
    // Placeholders cho list bỏ thủ công — tạo 1 lần, dùng lại trong các query (cùng mảng spuP)
    const boKeys = SPU_BO_THU_CONG.map((k) => k.toUpperCase());
    const boIn = sqlInList(spuP, boKeys); // vd $1,$2
    const notBo = boIn ? `AND upper(d.spu_key) NOT IN (${boIn})` : '';
    const isBo = boIn ? `upper(d.spu_key) IN (${boIn})` : 'false';
    const orBo = boIn ? `OR ${isBo}` : '';
    const isSanPham = `coalesce(d.loai_ma,'Sản phẩm') = 'Sản phẩm'`;

    const spuBreak = (
      await c.query(
        `
      SELECT
        count(*)::int AS tong_dim,
        count(*) FILTER (
          WHERE ${isSanPham}
            AND coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')
            ${notBo.replace(/^\s*AND/, 'AND')}
        )::int AS so_spu,
        count(*) FILTER (WHERE d.phan_khuc = 'Mã trung gian')::int AS bo_trung_gian,
        count(*) FILTER (WHERE d.phan_khuc = 'Dịch vụ/Đặt hàng')::int AS bo_dich_vu,
        count(*) FILTER (WHERE ${isBo})::int AS bo_thu_cong
      FROM ${fq('dim_spu')} d
      WHERE 1=1 ${spuDim} ${spuActive}`,
        spuP
      )
    ).rows[0];

    const spuByPk = (
      await c.query(
        `
      SELECT coalesce(d.phan_khuc,'(trống)') AS phan_khuc,
             count(*)::int AS so_ma,
             CASE
               WHEN coalesce(d.phan_khuc,'') IN ('Mã trung gian','Dịch vụ/Đặt hàng') THEN false
               ELSE true
             END AS tinh_vao_tong
      FROM ${fq('dim_spu')} d
      WHERE 1=1 ${spuDim} ${spuActive} ${notBo}
      GROUP BY d.phan_khuc
      ORDER BY tinh_vao_tong DESC, so_ma DESC`,
        spuP
      )
    ).rows;

    const pFromBo = pushParams(spuP, from);
    const pToBo = pushParams(spuP, to);
    let banKho = '';
    if (q.kho && q.kho !== 'All') {
      banKho = `AND f.kho = ${pushParams(spuP, q.kho)}`;
    }
    const spuBo = (
      await c.query(
        `
      SELECT d.spu_key, d.ten_san_pham, d.loai_ma, d.phan_khuc, d.chung_loai_pos,
             (${isBo}) AS bo_thu_cong,
             coalesce(ban.dt, 0)::float AS dt
      FROM ${fq('dim_spu')} d
      LEFT JOIN (
        SELECT f.spu_key, sum(f.order_revenue_vnd)::float AS dt
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.ngay BETWEEN ${pFromBo}::date AND ${pToBo}::date ${banKho}
        GROUP BY f.spu_key
      ) ban ON ban.spu_key = d.spu_key
      WHERE (
          coalesce(d.phan_khuc,'') IN ('Mã trung gian','Dịch vụ/Đặt hàng')
          ${orBo}
        ) ${spuDim} ${spuActive}
      ORDER BY bo_thu_cong DESC, coalesce(ban.dt,0) DESC, d.phan_khuc, d.spu_key`,
        spuP
      )
    ).rows;

    const spuBanKy = (
      await c.query(
        `
      SELECT count(DISTINCT f.spu_key)::int AS so_spu_co_ban
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${ff.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}`,
        p
      )
    ).rows[0];

    const byKho = (
      await c.query(
        `
      SELECT f.kho,
             sum(f.order_revenue_vnd)::float AS dt,
             sum(f.don_chot)::float AS don,
             sum(f.so_luong)::float AS sl,
             CASE WHEN sum(f.don_chot)=0 THEN NULL
                  ELSE sum(f.order_revenue_vnd)/sum(f.don_chot) END AS tb_don
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${dimKpi.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}
        ${notDichVuDt(dimKpi.dim)}
      GROUP BY f.kho ORDER BY dt DESC`,
        p
      )
    ).rows;

    const pMa = [from, to];
    const ffMa = factFilters(q, pMa, 'f', 'dx');
    const dimMa = ensureDimJoin(ffMa, 'f', 'dx');
    const byMa = (
      await c.query(
        `
      SELECT coalesce(nullif(btrim(${dimMa.dim}.ma_cu_moi),''),'Mã cũ') AS ma_cu_moi,
             sum(f.order_revenue_vnd)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${dimMa.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ffMa.where}
        ${notDichVuDt(dimMa.dim)}
      GROUP BY 1 ORDER BY dt DESC`,
        pMa
      )
    ).rows;

    const daily = (
      await c.query(
        `
      SELECT f.ngay::text AS ngay, sum(f.order_revenue_vnd)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${dimKpi.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}
        ${notDichVuDt(dimKpi.dim)}
      GROUP BY f.ngay ORDER BY f.ngay`,
        p
      )
    ).rows;

    const pTg = [from, to];
    const ffTg = factFilters(q, pTg, 'f', 'dx');
    const trungGian = (
      await c.query(
        `
      SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      ${ffTg.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ffTg.where}
        AND d.phan_khuc = 'Mã trung gian'`,
        pTg
      )
    ).rows[0];

    // Giống PBI: fact_po_moi_nhat + quá hạn so với TODAY() (PO không có cột kho)
    const pPo = [];
    const ffPo = factFilters(q, pPo, 'po', 'd', { skipKho: true });
    const po = (
      await c.query(
        `
      SELECT coalesce(sum(po.so_luong_con_thieu),0)::float AS dang_ve,
             coalesce(sum(po.so_luong_con_thieu) FILTER (WHERE po.han_giao < CURRENT_DATE),0)::float AS qua_han
      FROM ${fq('fact_po_moi_nhat')} po
      ${ffPo.join}
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${ffPo.where}`,
        pPo
      )
    ).rows[0];

    // DT thành công theo Ngày thành công (ngay_thanh_cong từ status_history POS)
    const pTc = [from, to];
    let khoTc = '';
    if (q.kho && q.kho !== 'All') khoTc = ` AND o.kho = ${pushParams(pTc, q.kho)}`;
    const tc = (
      await c.query(
        `
      SELECT coalesce(sum(o.tong_sau_giam),0)::float AS dt,
             count(*)::int AS don
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay_thanh_cong BETWEEN $1::date AND $2::date ${khoTc}`,
        pTc
      )
    ).rows[0];

    const benchmark = daily.length ? daily.reduce((s, r) => s + r.dt, 0) / daily.length : 0;
    const dtThanhCong = tc?.dt || 0;

    // TB/đơn: DT sản phẩm (đã trừ mã trung gian) / đơn chốt — không tính DT TG vào giá trị đơn
    const dtTg = Number(trungGian.dt) || 0;
    const dtSanPham = Math.max((Number(kpi.dt) || 0) - dtTg, 0);
    const tbDon = kpi.don ? dtSanPham / kpi.don : null;

    return {
      from,
      to,
      kpi: {
        ...kpi,
        so_spu: spuBreak.so_spu,
        tb_don: tbDon,
        benchmark,
        dt_trung_gian: dtTg,
        hang_dang_ve: po.dang_ve,
        sl_qua_han: po.qua_han,
        dt_thanh_cong: dtThanhCong,
        don_thanh_cong: tc?.don || 0,
        ty_le_thanh_cong: kpi.dt ? dtThanhCong / kpi.dt : null,
      },
      spuMeta: {
        tong_dim: spuBreak.tong_dim,
        so_spu: spuBreak.so_spu,
        bo_trung_gian: spuBreak.bo_trung_gian,
        bo_dich_vu: spuBreak.bo_dich_vu,
        so_spu_co_ban: spuBanKy.so_spu_co_ban,
        byPk: spuByPk,
        bo: spuBo,
        bo_thu_cong: spuBreak.bo_thu_cong,
        cong_thuc: `${spuBreak.tong_dim} active trong kỳ − ${spuBreak.bo_dich_vu} DV − ${spuBreak.bo_trung_gian} TG − ${spuBreak.bo_thu_cong || 0} thủ công = ${spuBreak.so_spu}`,
      },
      byKho,
      byMa,
      daily,
    };
  });
}

async function sanPham(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const p = [from, to];
    if (q.kho && q.kho !== 'All') p; // kho via where below
    let where = '';
    if (q.kho && q.kho !== 'All') where += ` AND f.kho = ${pushParams(p, q.kho)}`;
    where += dimWhere(q, p, 'd');

    const byPk = (
      await c.query(
        `
      SELECT d.phan_khuc, sum(f.order_revenue_vnd)::float AS dt, sum(f.so_luong)::float AS sl
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
        AND d.phan_khuc IN ('Bán chạy','Bán thường','Bán chậm')
      GROUP BY 1 ORDER BY dt DESC`,
        p
      )
    ).rows;

    // Tỷ trọng = DT nhóm / tổng DT các nhóm × 100
    const byNhom = (
      await c.query(
        `
      WITH cur AS (
        SELECT coalesce(nullif(d.chung_loai,''),'(trống)') AS nhom,
               sum(f.order_revenue_vnd)::float AS dt
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
        WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
          AND coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')
        GROUP BY 1
      ),
      tot AS (SELECT nullif(sum(dt),0) AS tong FROM cur)
      SELECT c.nhom, c.dt,
             round((c.dt / tot.tong * 100)::numeric, 1)::float AS ty_trong_pct
      FROM cur c, tot
      ORDER BY c.dt DESC
      LIMIT 10`,
        p
      )
    ).rows;

    const top = (
      await c.query(
        `
      SELECT f.spu_key, d.spunew, d.ten_san_pham, d.phan_khuc,
             sum(f.order_revenue_vnd)::float AS dt, sum(f.so_luong)::float AS sl
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
        AND coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')
      GROUP BY 1,2,3,4 ORDER BY dt DESC LIMIT 50`,
        p
      )
    ).rows;

    const warn = (
      await c.query(
        `
      SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
        AND d.phan_khuc = 'Mã trung gian'`,
        p
      )
    ).rows[0];

    return { from, to, byPk, byNhom, top, warn_dt: warn.dt };
  });
}

/** Giống PBI: VAR d = MAX(fact_ton_kho[ngay]) trong kỳ → chỉ SUM tồn ngày d (không cộng cả kỳ). */
async function tonCuoiKyNgay(c, from, to, kho) {
  const p = [from, to];
  let khoSql = '';
  if (kho && kho !== 'All') khoSql = ` AND t.kho = ${pushParams(p, kho)}`;

  let asOf = (
    await c.query(
      `SELECT max(t.ngay)::text AS d
       FROM ${fq('fact_ton_kho_moi_nhat')} t
       WHERE t.ngay BETWEEN $1::date AND $2::date ${khoSql}`,
      p
    )
  ).rows[0].d;

  // Không có dòng trong kỳ → lùi về ngày tồn gần nhất ≤ cuối kỳ
  if (!asOf) {
    const p2 = [to];
    let kho2 = '';
    if (kho && kho !== 'All') kho2 = ` AND t.kho = ${pushParams(p2, kho)}`;
    asOf = (
      await c.query(
        `SELECT max(t.ngay)::text AS d
         FROM ${fq('fact_ton_kho_moi_nhat')} t
         WHERE t.ngay <= $1::date ${kho2}`,
        p2
      )
    ).rows[0].d;
  }

  return asOf;
}

async function tonKho(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const asOf = await tonCuoiKyNgay(c, from, to, q.kho);
    if (!asOf) {
      return {
        from,
        to,
        asOf: null,
        kpi: { sl: 0, gt: 0 },
        byKho: [],
        matrix: [],
        tonXau: [],
        tonXauByKho: [],
      };
    }

    // Phân khúc = SL 30n tại ĐÚNG kho (Thái/Nhật tách). Không dùng dim_spu.phan_khuc global.
    const p = [asOf];
    let wTon = ` AND t.kho IN ('KHO THÁI LAN', 'KHO NHẬT BẢN')`;
    if (q.kho && q.kho !== 'All') wTon += ` AND t.kho = ${pushParams(p, q.kho)}`;
    // Chỉ lọc thuộc tính dim (nhóm/mã/SPU) — KHÔNG lọc phan_khuc từ dim
    const qNoPk = { ...q, phan_khuc: 'All' };
    wTon += dimWhere(qNoPk, p, 'd');

    let pkFilter = '';
    if (q.phan_khuc && q.phan_khuc !== 'All') {
      pkFilter = ` WHERE phan_khuc = ${pushParams(p, q.phan_khuc)}`;
    }

    const baseCte = `
      WITH metric AS (
        SELECT f.spu_key, f.kho, coalesce(sum(f.so_luong), 0)::float AS sl_30
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.ngay BETWEEN ($1::date - INTERVAL '1 month')::date AND $1::date
          AND f.kho IN ('KHO THÁI LAN', 'KHO NHẬT BẢN')
        GROUP BY f.spu_key, f.kho
      ),
      base AS (
        SELECT t.spu_key, t.kho, d.ten_san_pham, d.chung_loai,
               sum(t.inventory_qty)::float AS sl,
               sum(t.inventory_value)::float AS gt,
               coalesce(m.sl_30, 0)::float AS sl_30,
               CASE
                 WHEN coalesce(m.sl_30, 0) = 0 THEN 'Tồn xấu'
                 WHEN coalesce(m.sl_30, 0) <= 9 THEN 'Bán chậm'
                 WHEN coalesce(m.sl_30, 0) <= 29 THEN 'Bán thường'
                 ELSE 'Bán chạy'
               END AS phan_khuc
        FROM ${fq('fact_ton_kho_moi_nhat')} t
        JOIN ${fq('dim_spu')} d ON d.spu_key = t.spu_key
        LEFT JOIN metric m ON m.spu_key = t.spu_key AND m.kho = t.kho
        WHERE t.ngay = $1::date ${wTon}
          AND coalesce(t.inventory_qty, 0) <> 0
          AND coalesce(d.loai_ma, 'Sản phẩm') = 'Sản phẩm'
          AND coalesce(d.phan_khuc, '') NOT IN ('Mã trung gian', 'Dịch vụ/Đặt hàng', 'Hàng mới')
          AND coalesce(d.chung_loai, '') <> 'Các sản phẩm khác'
        GROUP BY t.spu_key, t.kho, d.ten_san_pham, d.chung_loai, m.sl_30
      ),
      filtered AS (
        SELECT * FROM base
        ${pkFilter}
      )`;

    const kpi = (
      await c.query(
        `
      ${baseCte}
      SELECT coalesce(sum(sl),0)::float AS sl, coalesce(sum(gt),0)::float AS gt
      FROM filtered`,
        p
      )
    ).rows[0];

    const byKho = (
      await c.query(
        `
      ${baseCte}
      SELECT kho, sum(sl)::float AS sl, sum(gt)::float AS gt
      FROM filtered
      GROUP BY kho ORDER BY gt DESC`,
        p
      )
    ).rows;

    const matrix = (
      await c.query(
        `
      ${baseCte}
      SELECT kho, phan_khuc, sum(sl)::float AS sl, sum(gt)::float AS gt
      FROM filtered
      GROUP BY kho, phan_khuc
      ORDER BY kho, phan_khuc`,
        p
      )
    ).rows;

    const tonXau = (
      await c.query(
        `
      ${baseCte}
      SELECT spu_key, ten_san_pham, phan_khuc, chung_loai, kho, sl, gt
      FROM filtered
      WHERE phan_khuc = 'Tồn xấu'
      ORDER BY sl DESC, gt DESC
      LIMIT 400`,
        p
      )
    ).rows;

    const tonXauByKho = [];
    {
      const map = new Map();
      for (const r of tonXau) {
        const k = r.kho || '—';
        const cur = map.get(k) || { kho: k, so_ma: 0, sl: 0, gt: 0 };
        cur.so_ma += 1;
        cur.sl += Number(r.sl) || 0;
        cur.gt += Number(r.gt) || 0;
        map.set(k, cur);
      }
      tonXauByKho.push(...[...map.values()].sort((a, b) => a.kho.localeCompare(b.kho, 'vi')));
    }

    return { from, to, asOf, kpi, byKho, matrix, tonXau, tonXauByKho };
  });
}

async function hangDangVe(q) {
  const { to } = parseRange(q);
  return withDb(async (c) => {
    const p = [];
    let where = dimWhere(q, p, 'd');
    if (q.spu && q.spu !== 'All') {
      where += ` AND upper(po.spu_key) = ${pushParams(p, String(q.spu).toUpperCase())}`;
    }
    if (q.flag_eta && q.flag_eta !== 'All') {
      if (q.flag_eta === 'Quá hạn') where += ` AND po.han_giao < CURRENT_DATE`;
      else if (q.flag_eta === 'Sắp đến hạn') {
        where += ` AND po.han_giao >= CURRENT_DATE AND po.han_giao <= CURRENT_DATE + 7`;
      } else if (q.flag_eta === 'Còn hạn') where += ` AND po.han_giao > CURRENT_DATE + 7`;
    }

    const kpi = (
      await c.query(
        `
      SELECT count(DISTINCT po.ma_po)::int AS so_po,
             coalesce(sum(po.so_luong_con_thieu),0)::float AS dang_ve,
             coalesce(sum(po.so_luong_con_thieu) FILTER (WHERE po.han_giao < CURRENT_DATE),0)::float AS qua_han,
             coalesce(sum(po.so_luong_con_thieu) FILTER (
               WHERE po.han_giao >= CURRENT_DATE AND po.han_giao <= CURRENT_DATE + 7),0)::float AS sap_han,
             coalesce(sum(po.so_luong_con_thieu) FILTER (WHERE po.han_giao > CURRENT_DATE + 7),0)::float AS con_han
      FROM ${fq('fact_po_moi_nhat')} po
      LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = po.spu_key
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${where}`,
        p
      )
    ).rows[0];

    const bySpu = (
      await c.query(
        `
      SELECT po.spu_key, coalesce(d.ten_san_pham, po.spu_key) AS ten,
             sum(po.so_luong_con_thieu)::float AS sl
      FROM ${fq('fact_po_moi_nhat')} po
      LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = po.spu_key
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${where}
      GROUP BY po.spu_key, coalesce(d.ten_san_pham, po.spu_key)
      ORDER BY sl DESC LIMIT 15`,
        p
      )
    ).rows;

    const rows = (
      await c.query(
        `
      SELECT po.ma_po, po.spu_key, po.sku, po.nha_cung_cap,
             po.han_giao::text AS han_giao,
             po.so_luong_con_thieu::float AS dang_ve,
             d.phan_khuc,
             CASE
               WHEN po.han_giao < CURRENT_DATE THEN 'Quá hạn'
               WHEN po.han_giao <= CURRENT_DATE + 7 THEN 'Sắp đến hạn'
               ELSE 'Còn hạn'
             END AS flag_eta
      FROM ${fq('fact_po_moi_nhat')} po
      LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = po.spu_key
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${where}
      ORDER BY
        CASE
          WHEN po.han_giao < CURRENT_DATE THEN 0
          WHEN po.han_giao <= CURRENT_DATE + 7 THEN 1
          ELSE 2
        END,
        po.han_giao,
        po.so_luong_con_thieu DESC
      LIMIT 300`,
        p
      )
    ).rows;

    return { asOf: to, kpi, bySpu, rows };
  });
}

/**
 * Hành động tuần này — chốt phân khúc theo 3 kỳ (1 / 15 / cuối tháng),
 * rồi theo dõi realtime sau ngày chốt (DT/SL sau chốt + tồn hiện tại).
 */
async function hanhDong(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const emptyPack = () => ({
      rows: [],
      total: { so_ma: 0, ton_sl: 0, ton_gt: 0, dt: 0, sl_ban: 0, dang_ve: 0 },
      byKho: [],
    });

    let kyRows = [];
    try {
      kyRows = (
        await c.query(
          `
          SELECT ngay_snapshot::text AS ngay_snapshot,
                 ky_trong_thang, ky_label,
                 tu_ngay_30::text AS tu_ngay_30,
                 den_ngay_30::text AS den_ngay_30
          FROM ${fq('dim_ky_snapshot')}
          ORDER BY ngay_snapshot DESC`
        )
      ).rows;
    } catch (_) {
      kyRows = [];
    }

    let snap = q.ngay_snapshot || null;
    if (!snap) {
      const hit =
        kyRows.find((s) => s.ngay_snapshot <= to) ||
        kyRows[0];
      snap = hit ? hit.ngay_snapshot : null;
    }
    const ky = kyRows.find((s) => s.ngay_snapshot === snap) || null;

    const asOf = await tonCuoiKyNgay(c, from, to, q.kho);
    if (!asOf || !snap || !ky) {
      return {
        asOf,
        from,
        to,
        snap,
        ky,
        snapshots: kyRows,
        banChay: emptyPack(),
        tonXau: emptyPack(),
        banCham: emptyPack(),
        note: 'Chưa có kỳ chốt (1 / 15 / cuối tháng). Chạy chốt snapshot trước.',
      };
    }

    // $1 snap, $2 to (theo dõi đến), $3 asOf tồn, $4 tu_30, $5 den_30(=snap)
    const p = [snap, to, asOf, ky.tu_ngay_30, ky.den_ngay_30];
    let khoSqlT = '';
    let khoSqlF = '';
    if (q.kho && q.kho !== 'All') {
      khoSqlT = ` AND t.kho = $${p.length + 1}`;
      khoSqlF = ` AND f.kho = $${p.length + 1}`;
      p.push(q.kho);
    }
    const extra = [];
    if (q.phan_nhom && q.phan_nhom !== 'All') {
      extra.push(`AND d.chung_loai = $${p.length + extra.length + 1}`);
      p.push(q.phan_nhom);
    }
    if (q.phan_khuc && q.phan_khuc !== 'All') {
      extra.push(`AND pk.phan_khuc = $${p.length + extra.length + 1}`);
      p.push(q.phan_khuc);
    }
    const extraSql = extra.join(' ');

    const rows = (
      await c.query(
        `
      WITH metric_chot AS (
        -- SL 30n theo TỪNG KHO — Thái/Nhật không gộp
        SELECT f.spu_key, f.kho,
               coalesce(sum(f.so_luong),0)::float AS sl_30,
               coalesce(sum(f.don_chot),0)::float AS don_30
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.ngay BETWEEN $4::date AND $5::date
          AND f.kho IN ('KHO THÁI LAN', 'KHO NHẬT BẢN')
        GROUP BY f.spu_key, f.kho
      ),
      ton AS (
        SELECT t.spu_key, t.kho,
               sum(t.inventory_qty)::float AS ton_sl,
               sum(t.inventory_value)::float AS ton_gt
        FROM ${fq('fact_ton_kho_moi_nhat')} t
        WHERE t.ngay = $3::date ${khoSqlT}
          AND t.kho IN ('KHO THÁI LAN', 'KHO NHẬT BẢN')
        GROUP BY t.spu_key, t.kho
        HAVING sum(t.inventory_qty) <> 0
      ),
      pk AS (
        SELECT d.spu_key, d.ten_san_pham, d.chung_loai, ton.kho,
               coalesce(m.sl_30, 0)::float AS sl_30,
               coalesce(m.don_30, 0)::float AS don_30,
               ton.ton_sl, ton.ton_gt,
               CASE
                 WHEN coalesce(m.sl_30, 0) = 0 THEN 'Tồn xấu'
                 WHEN coalesce(m.sl_30, 0) <= 9 THEN 'Bán chậm'
                 WHEN coalesce(m.sl_30, 0) <= 29 THEN 'Bán thường'
                 ELSE 'Bán chạy'
               END AS phan_khuc
        FROM ton
        JOIN ${fq('dim_spu')} d ON d.spu_key = ton.spu_key
        LEFT JOIN metric_chot m ON m.spu_key = ton.spu_key AND m.kho = ton.kho
        WHERE coalesce(d.loai_ma, 'Sản phẩm') = 'Sản phẩm'
          AND coalesce(d.phan_khuc, '') NOT IN ('Mã trung gian', 'Dịch vụ/Đặt hàng', 'Hàng mới')
          AND coalesce(d.chung_loai, '') <> 'Các sản phẩm khác'
      ),
      -- Realtime sau chốt: từ ngày sau snapshot → Đến ngày filter
      ban AS (
        SELECT f.spu_key, f.kho,
               sum(f.order_revenue_vnd)::float AS dt,
               sum(f.so_luong)::float AS sl
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.ngay > $1::date AND f.ngay <= $2::date ${khoSqlF}
        GROUP BY f.spu_key, f.kho
      ),
      po AS (
        SELECT po.spu_key, sum(po.so_luong_con_thieu)::float AS dang_ve
        FROM ${fq('fact_po_moi_nhat')} po
        WHERE coalesce(po.so_luong_con_thieu,0) > 0
        GROUP BY po.spu_key
      )
      SELECT pk.spu_key, pk.ten_san_pham, pk.phan_khuc, pk.kho,
             pk.ton_sl, pk.ton_gt,
             coalesce(ban.dt,0)::float AS dt,
             coalesce(ban.sl,0)::float AS sl_ban,
             coalesce(po.dang_ve,0)::float AS dang_ve,
             pk.don_30, pk.sl_30,
             -- Ngày cover = tồn / (SL chốt 30n / 30). Có hàng về thì cover_hieu_luc nới hơn.
             CASE
               WHEN coalesce(pk.sl_30, 0) > 0
                 THEN (pk.ton_sl * 30.0 / pk.sl_30)
               ELSE NULL
             END::float AS cover_days,
             CASE
               WHEN coalesce(pk.sl_30, 0) > 0
                 THEN ((pk.ton_sl + coalesce(po.dang_ve, 0)) * 30.0 / pk.sl_30)
               ELSE NULL
             END::float AS cover_days_co_ve,
             -- Cảnh báo theo tồn hiện (không cộng hàng về — PO xem cột riêng)
             CASE
               WHEN pk.ton_sl <= 0 THEN 'Thiếu hàng'
               WHEN coalesce(pk.sl_30, 0) <= 0 THEN 'Còn hàng'
               WHEN (pk.ton_sl * 30.0 / pk.sl_30) < 7 THEN 'Thiếu hàng'
               WHEN (pk.ton_sl * 30.0 / pk.sl_30) < 15 THEN 'Sắp hết hàng'
               ELSE 'Còn hàng'
             END AS canh_bao,
             CASE
               WHEN pk.phan_khuc = 'Bán chạy' THEN 'Ưu tiên nhận/QC/lên kệ'
               WHEN pk.phan_khuc = 'Bán thường' THEN 'Giữ stock — cân nhắc đặt nếu thiếu'
               WHEN pk.phan_khuc = 'Tồn xấu' THEN 'Xả tồn / cắt đặt'
               WHEN pk.phan_khuc = 'Bán chậm' THEN 'Theo dõi — hạn chế nhập'
               ELSE ''
             END AS goi_y
      FROM pk
      LEFT JOIN ban ON ban.spu_key = pk.spu_key AND ban.kho = pk.kho
      LEFT JOIN po ON po.spu_key = pk.spu_key
      JOIN ${fq('dim_spu')} d ON d.spu_key = pk.spu_key
      WHERE pk.phan_khuc IN ('Bán chạy','Bán thường','Tồn xấu','Bán chậm')
        ${extraSql}
      ORDER BY
        CASE pk.phan_khuc
          WHEN 'Bán chạy' THEN 0
          WHEN 'Bán thường' THEN 1
          WHEN 'Tồn xấu' THEN 2
          ELSE 3
        END,
        coalesce(ban.dt, 0) DESC,
        pk.ton_gt DESC`,
        p
      )
    ).rows;

    const sum = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
    const byKho = (list) => {
      const map = new Map();
      for (const r of list) {
        const k = r.kho || '—';
        const cur = map.get(k) || { kho: k, so_ma: 0, ton_sl: 0, ton_gt: 0, dt: 0, sl_ban: 0 };
        cur.so_ma += 1;
        cur.ton_sl += Number(r.ton_sl) || 0;
        cur.ton_gt += Number(r.ton_gt) || 0;
        cur.dt += Number(r.dt) || 0;
        cur.sl_ban += Number(r.sl_ban) || 0;
        map.set(k, cur);
      }
      return [...map.values()].sort((a, b) => a.kho.localeCompare(b.kho, 'vi'));
    };
    const pack = (list) => ({
      rows: list.slice(0, 80),
      total: {
        so_ma: list.length,
        ton_sl: sum(list, 'ton_sl'),
        ton_gt: sum(list, 'ton_gt'),
        dt: sum(list, 'dt'),
        sl_ban: sum(list, 'sl_ban'),
        dang_ve: sum(list, 'dang_ve'),
      },
      byKho: byKho(list),
    });

    const uuTien = rows
      .filter((r) => r.phan_khuc === 'Bán chạy' || r.phan_khuc === 'Bán thường')
      .sort((a, b) => (Number(b.dt) || 0) - (Number(a.dt) || 0) || (Number(b.sl_30) || 0) - (Number(a.sl_30) || 0));

    return {
      asOf,
      from,
      to,
      snap,
      ky,
      snapshots: kyRows,
      note: `Phân khúc theo SL 30n TỪNG KHO tại ${ky.ky_label} (${ky.tu_ngay_30}→${ky.den_ngay_30}). Thái/Nhật tách riêng — bán Nhật không gỡ tồn xấu Thái. DT/SL sau chốt = ${snap}→${to}. Tồn = ${asOf}.`,
      banChay: pack(uuTien),
      tonXau: pack(rows.filter((r) => r.phan_khuc === 'Tồn xấu')),
      banCham: pack(rows.filter((r) => r.phan_khuc === 'Bán chậm')),
    };
  });
}

async function spuCheck(q) {
  const key = String(q.key || q.spu || '')
    .trim()
    .toUpperCase();
  if (!key) return { key: '', found: false };
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const r = (
      await c.query(
        `
      SELECT spu_key, ten_san_pham, loai_ma, phan_khuc, chung_loai, chung_loai_pos,
             ma_cu_moi, spunew, spu_goc,
             don_30_ngay::float AS don_30_ngay,
             sl_30_ngay::float AS sl_30_ngay,
             ngay_chot_phan_khuc::text AS ngay_chot_phan_khuc,
             trong_danh_muc, coalesce(active, true) AS active
      FROM ${fq('dim_spu')}
      WHERE upper(spu_key) = $1
         OR upper(spu_key) LIKE $1 || '%'
         OR upper(coalesce(spu_goc,'')) LIKE '%' || $1 || '%'
         OR upper(coalesce(spunew,'')) LIKE '%' || $1 || '%'
      ORDER BY CASE WHEN upper(spu_key)=$1 THEN 0 WHEN upper(spu_key) LIKE $1 || '%' THEN 1 ELSE 2 END,
               spu_key
      LIMIT 8`,
        [key]
      )
    ).rows;
    if (!r.length) return { key, found: false, from, to, rows: [] };

    const keys = r.map((x) => x.spu_key);
    const ban = (
      await c.query(
        `
        SELECT f.spu_key, f.kho,
               sum(f.order_revenue_vnd)::float AS dt,
               sum(f.so_luong)::float AS sl,
               sum(f.don_chot)::float AS don
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.spu_key = ANY($1::text[])
          AND f.ngay BETWEEN $2::date AND $3::date
        GROUP BY f.spu_key, f.kho
        ORDER BY f.spu_key, dt DESC NULLS LAST`,
        [keys, from, to]
      )
    ).rows;

    const asOf = await tonCuoiKyNgay(c, from, to, q.kho);
    let ton = [];
    if (asOf) {
      ton = (
        await c.query(
          `
          SELECT t.spu_key, t.kho,
                 sum(t.inventory_qty)::float AS ton_sl,
                 sum(t.inventory_value)::float AS ton_gt
          FROM ${fq('fact_ton_kho_moi_nhat')} t
          WHERE t.spu_key = ANY($1::text[]) AND t.ngay = $2::date
          GROUP BY t.spu_key, t.kho
          HAVING sum(t.inventory_qty) <> 0
          ORDER BY t.spu_key, ton_sl DESC`,
          [keys, asOf]
        )
      ).rows;
    }

    let po = [];
    try {
      po = (
        await c.query(
          `
          SELECT po.spu_key,
                 sum(po.so_luong_con_thieu)::float AS dang_ve,
                 count(DISTINCT po.ma_po)::int AS so_po
          FROM ${fq('fact_po_moi_nhat')} po
          WHERE po.spu_key = ANY($1::text[])
            AND coalesce(po.so_luong_con_thieu,0) > 0
          GROUP BY po.spu_key`,
          [keys]
        )
      ).rows;
    } catch (_) {
      po = [];
    }

    const daily = (
      await c.query(
        `
        SELECT f.spu_key, f.ngay::text AS ngay,
               sum(f.order_revenue_vnd)::float AS dt,
               sum(f.so_luong)::float AS sl,
               sum(f.don_chot)::float AS don
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.spu_key = ANY($1::text[])
          AND f.ngay BETWEEN $2::date AND $3::date
        GROUP BY f.spu_key, f.ngay
        ORDER BY f.spu_key, f.ngay`,
        [keys, from, to]
      )
    ).rows;

    const rows = r.map((x) => {
      const banSp = ban.filter((b) => b.spu_key === x.spu_key);
      const tonSp = ton.filter((t) => t.spu_key === x.spu_key);
      const poSp = po.find((p) => p.spu_key === x.spu_key);
      const daySp = daily.filter((d) => d.spu_key === x.spu_key);
      return {
        ...x,
        ma_cu_moi: x.ma_cu_moi || 'Mã cũ',
        tinh_vao_tong:
          !['Mã trung gian', 'Dịch vụ/Đặt hàng'].includes(x.phan_khuc || '') &&
          !isBoThuCong(x.spu_key),
        bo_thu_cong: isBoThuCong(x.spu_key),
        ky: {
          from,
          to,
          dt: banSp.reduce((s, b) => s + (b.dt || 0), 0),
          sl: banSp.reduce((s, b) => s + (b.sl || 0), 0),
          don: banSp.reduce((s, b) => s + (b.don || 0), 0),
          by_kho: banSp,
        },
        ton: {
          as_of: asOf,
          sl: tonSp.reduce((s, t) => s + (t.ton_sl || 0), 0),
          gt: tonSp.reduce((s, t) => s + (t.ton_gt || 0), 0),
          by_kho: tonSp,
        },
        daily: daySp,
        dang_ve: poSp ? poSp.dang_ve : 0,
        so_po: poSp ? poSp.so_po : 0,
      };
    });
    return { key, found: true, from, to, asOf, rows };
  });
}

/**
 * Trang Phân tích doanh thu — trả lời: DT vì sao giảm, khách, SP, giá/KM, kênh, NV, NCC.
 * Doanh thu tổng đã loại Dịch vụ/Đặt hàng; Mã trung gian vẫn giữ.
 */
async function phanTichDoanhThu(q) {
  const { from, to } = parseRange(q);
  const { prevFrom, prevTo, days } = prevRange(from, to);
  return withDb(async (c) => {
    const p = [from, to];
    const ff = factFilters(q, p, 'f');
    const dim = ensureDimJoin(ff);
    const excl = notDichVuDt(dim.dim);

    const kpiCur = (
      await c.query(
        `
        SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt,
               coalesce(sum(f.don_chot),0)::float AS don,
               coalesce(sum(f.so_luong),0)::float AS sl
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        ${dim.join}
        WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where} ${excl}`,
        p
      )
    ).rows[0];

    const pPrev = [prevFrom, prevTo];
    const ffPrev = factFilters(q, pPrev, 'f');
    const dimPrev = ensureDimJoin(ffPrev);
    const kpiPrev = (
      await c.query(
        `
        SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt,
               coalesce(sum(f.don_chot),0)::float AS don,
               coalesce(sum(f.so_luong),0)::float AS sl
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        ${dimPrev.join}
        WHERE f.ngay BETWEEN $1::date AND $2::date ${ffPrev.where}
          ${notDichVuDt(dimPrev.dim)}`,
        pPrev
      )
    ).rows[0];

    const rangeParams = q.kho && q.kho !== 'All' ? [from, to, prevFrom, prevTo, q.kho] : [from, to, prevFrom, prevTo];
    const khoF5 = q.kho && q.kho !== 'All' ? ' AND f.kho = $5' : '';

    async function bridgeDim(expr) {
      return (
        await c.query(
          `
          WITH cur AS (
            SELECT ${expr} AS key,
                   sum(f.order_revenue_vnd)::float AS dt,
                   sum(f.don_chot)::float AS don
            FROM ${fq('fact_doanh_thu_moi_nhat')} f
            LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
            WHERE f.ngay BETWEEN $1::date AND $2::date ${khoF5}
              ${notDichVuDt('d')}
            GROUP BY 1
          ),
          prev AS (
            SELECT ${expr} AS key,
                   sum(f.order_revenue_vnd)::float AS dt,
                   sum(f.don_chot)::float AS don
            FROM ${fq('fact_doanh_thu_moi_nhat')} f
            LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
            WHERE f.ngay BETWEEN $3::date AND $4::date ${khoF5}
              ${notDichVuDt('d')}
            GROUP BY 1
          )
          SELECT coalesce(c.key, p.key) AS key,
                 coalesce(c.dt,0)::float AS dt,
                 coalesce(p.dt,0)::float AS dt_truoc,
                 (coalesce(c.dt,0)-coalesce(p.dt,0))::float AS delta_dt,
                 coalesce(c.don,0)::float AS don,
                 coalesce(p.don,0)::float AS don_truoc
          FROM cur c
          FULL OUTER JOIN prev p ON p.key = c.key
          ORDER BY delta_dt ASC
          LIMIT 12`,
          rangeParams
        )
      ).rows;
    }

    const bridgeKho = await bridgeDim(`coalesce(nullif(btrim(f.kho),''),'(trống)')`);
    const bridgePk2 = await bridgeDim(`coalesce(nullif(btrim(d.phan_khuc),''),'(trống)')`);
    const bridgeNhom = await bridgeDim(`coalesce(nullif(btrim(d.chung_loai),''),'(trống)')`);

    // ---- Khách hàng ----
    let khoO = '';
    const pKh = [from, to];
    if (q.kho && q.kho !== 'All') {
      khoO = ` AND o.kho = ${pushParams(pKh, q.kho)}`;
    }
    const khach = (
      await c.query(
        `
        WITH od AS (
          SELECT o.order_id,
                 coalesce(nullif(btrim(o.bill_phone),''), nullif(btrim(o.customer_id),''), o.order_id) AS kh_key,
                 o.bill_phone, o.bill_name, o.tong_sau_giam, o.ngay, o.trang_thai_ten
          FROM ${fq('fact_don_hang_moi_nhat')} o
          WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}
            AND o.trang_thai_ten IN ('delivered','shipped','received_money')
        ),
        agg AS (
          SELECT kh_key,
                 max(bill_name) AS ten,
                 max(bill_phone) AS phone,
                 count(DISTINCT order_id)::int AS so_don,
                 sum(tong_sau_giam)::float AS dt
          FROM od GROUP BY 1
        )
        SELECT
          count(*)::int AS so_kh,
          count(*) FILTER (WHERE so_don >= 2)::int AS kh_quay_lai,
          CASE WHEN count(*)=0 THEN NULL
               ELSE count(*) FILTER (WHERE so_don >= 2)::float / count(*)::float END AS ty_le_retention
        FROM agg`,
        pKh
      )
    ).rows[0];

    const topKh = (
      await c.query(
        `
        SELECT coalesce(nullif(btrim(o.bill_phone),''), nullif(btrim(o.customer_id),''), o.order_id) AS kh_key,
               max(o.bill_name) AS ten,
               max(o.bill_phone) AS phone,
               count(DISTINCT o.order_id)::int AS so_don,
               sum(o.tong_sau_giam)::float AS dt
        FROM ${fq('fact_don_hang_moi_nhat')} o
        WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}
          AND o.trang_thai_ten IN ('delivered','shipped','received_money')
        GROUP BY 1
        ORDER BY dt DESC NULLS LAST
        LIMIT 15`,
        pKh
      )
    ).rows;

    // ---- Kênh ----
    const pKenh = [from, to, prevFrom, prevTo];
    let khoK = '';
    if (q.kho && q.kho !== 'All') khoK = ` AND o.kho = $5`;
    const kenhParams = q.kho && q.kho !== 'All' ? [...pKenh, q.kho] : pKenh;
    const byKenh = (
      await c.query(
        `
        WITH cur AS (
          SELECT coalesce(nullif(btrim(o.kenh),''),'(không gắn kênh)') AS kenh,
                 count(DISTINCT o.order_id)::int AS don,
                 sum(o.tong_sau_giam)::float AS dt
          FROM ${fq('fact_don_hang_moi_nhat')} o
          WHERE o.ngay BETWEEN $1::date AND $2::date ${khoK}
            AND o.trang_thai_ten IN ('delivered','shipped','received_money')
          GROUP BY 1
        ),
        prev AS (
          SELECT coalesce(nullif(btrim(o.kenh),''),'(không gắn kênh)') AS kenh,
                 count(DISTINCT o.order_id)::int AS don,
                 sum(o.tong_sau_giam)::float AS dt
          FROM ${fq('fact_don_hang_moi_nhat')} o
          WHERE o.ngay BETWEEN $3::date AND $4::date ${khoK}
            AND o.trang_thai_ten IN ('delivered','shipped','received_money')
          GROUP BY 1
        )
        SELECT coalesce(c.kenh, p.kenh) AS kenh,
               coalesce(c.dt,0)::float AS dt,
               coalesce(p.dt,0)::float AS dt_truoc,
               (coalesce(c.dt,0)-coalesce(p.dt,0))::float AS delta_dt,
               coalesce(c.don,0)::int AS don,
               coalesce(p.don,0)::int AS don_truoc
        FROM cur c FULL OUTER JOIN prev p ON p.kenh = c.kenh
        ORDER BY delta_dt ASC`,
        kenhParams
      )
    ).rows;

    // ---- Giá / KM (từ dòng đơn) ----
    const pKm = [from, to];
    let khoCt = '';
    if (q.kho && q.kho !== 'All') khoCt = ` AND ct.kho = ${pushParams(pKm, q.kho)}`;
    const km = (
      await c.query(
        `
        SELECT
          sum(ct.so_luong * coalesce(ct.gia_niem_yet,0))::float AS gia_niem_yet,
          sum(ct.so_luong * coalesce(ct.gia_niem_yet,0) - coalesce(ct.tong_giam_dong,0))::float AS gia_ban,
          sum(coalesce(ct.tong_giam_dong,0))::float AS giam_gia,
          CASE WHEN sum(ct.so_luong * coalesce(ct.gia_niem_yet,0))=0 THEN NULL
               ELSE sum(coalesce(ct.tong_giam_dong,0))
                    / sum(ct.so_luong * coalesce(ct.gia_niem_yet,0)) END AS ty_le_giam
        FROM ${fq('fact_don_hang_ct_moi_nhat')} ct
        JOIN ${fq('fact_don_hang_moi_nhat')} o ON o.order_id = ct.order_id
        LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = ct.spu_key
        WHERE ct.ngay BETWEEN $1::date AND $2::date ${khoCt}
          AND o.trang_thai_ten IN ('delivered','shipped','received_money')
          ${notDichVuDt('d')}`,
        pKm
      )
    ).rows[0];

    // ---- NV bán ----
    const byNv = (
      await c.query(
        `
        SELECT coalesce(nullif(btrim(o.nv_ban),''),'(trống)') AS nv,
               count(DISTINCT o.order_id)::int AS don,
               sum(o.tong_sau_giam)::float AS dt
        FROM ${fq('fact_don_hang_moi_nhat')} o
        WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}
          AND o.trang_thai_ten IN ('delivered','shipped','received_money')
        GROUP BY 1 ORDER BY dt DESC NULLS LAST LIMIT 12`,
        pKh
      )
    ).rows;

    // Đơn chốt KPI = SUM(don_chot) fact_doanh_thu (khớp Tổng quan / POS).
    // Hủy/hoàn vẫn từ fact_don_hang (status).
    const pChot = [from, to];
    let khoFChot = '';
    if (q.kho && q.kho !== 'All') khoFChot = ` AND f.kho = ${pushParams(pChot, q.kho)}`;
    const donChotKpi = (
      await c.query(
        `
        SELECT coalesce(sum(f.don_chot),0)::float AS don_chot
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
        WHERE f.ngay BETWEEN $1::date AND $2::date ${khoFChot}
          ${notDichVuDt('d')}`,
        pChot
      )
    ).rows[0];

    const traHangStatus = (
      await c.query(
        `
        SELECT
          count(*) FILTER (WHERE o.trang_thai_ten = 'canceled')::int AS don_huy,
          -- Khớp tab POS "Đã hoàn" = returned (không gộp part_returned / Hoàn 1 phần)
          count(*) FILTER (WHERE o.trang_thai_ten = 'returned')::int AS don_hoan,
          count(*) FILTER (WHERE o.trang_thai_ten = 'part_returned')::int AS don_hoan_1p
        FROM ${fq('fact_don_hang_moi_nhat')} o
        WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}`,
        pKh
      )
    ).rows[0];

    const traHang = {
      don_chot: donChotKpi.don_chot,
      don_huy: traHangStatus.don_huy,
      don_hoan: traHangStatus.don_hoan,
      don_hoan_1p: traHangStatus.don_hoan_1p,
    };

    const donHoanRows = (
      await c.query(
        `
        SELECT o.order_id,
               o.ngay::text AS ngay,
               coalesce(nullif(btrim(o.kho),''),'—') AS kho,
               coalesce(nullif(btrim(o.nv_tao),''),'(trống)') AS nv_tao,
               coalesce(nullif(btrim(o.nv_ban),''),'(trống)') AS nv_ban,
               coalesce(nullif(btrim(o.kenh),''),'(không gắn kênh)') AS kenh,
               coalesce(nullif(btrim(o.bill_name),''),'') AS khach,
               o.trang_thai_ten AS trang_thai,
               coalesce(o.tong_sau_giam,0)::float AS tong_tien
        FROM ${fq('fact_don_hang_moi_nhat')} o
        WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}
          AND o.trang_thai_ten = 'returned'
        ORDER BY o.ngay DESC, o.order_id DESC
        LIMIT 200`,
        pKh
      )
    ).rows;

    const donHoanByNv = (
      await c.query(
        `
        SELECT coalesce(nullif(btrim(o.nv_tao),''), nullif(btrim(o.nv_ban),''), '(trống)') AS nv,
               count(*)::int AS so_don,
               coalesce(sum(o.tong_sau_giam),0)::float AS tong_tien
        FROM ${fq('fact_don_hang_moi_nhat')} o
        WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}
          AND o.trang_thai_ten = 'returned'
        GROUP BY 1
        ORDER BY so_don DESC, tong_tien DESC`,
        pKh
      )
    ).rows;

    // Đơn hủy — ai tạo / NV bán (người gắn trên đơn)
    const donHuyRows = (
      await c.query(
        `
        SELECT o.order_id,
               o.ngay::text AS ngay,
               coalesce(nullif(btrim(o.kho),''),'—') AS kho,
               coalesce(nullif(btrim(o.nv_tao),''),'(trống)') AS nv_tao,
               coalesce(nullif(btrim(o.nv_ban),''),'(trống)') AS nv_ban,
               coalesce(nullif(btrim(o.kenh),''),'(không gắn kênh)') AS kenh,
               coalesce(nullif(btrim(o.bill_name),''),'') AS khach,
               coalesce(o.tong_sau_giam,0)::float AS tong_tien
        FROM ${fq('fact_don_hang_moi_nhat')} o
        WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}
          AND o.trang_thai_ten = 'canceled'
        ORDER BY o.ngay DESC, o.order_id DESC
        LIMIT 200`,
        pKh
      )
    ).rows;

    const donHuyByNv = (
      await c.query(
        `
        SELECT coalesce(nullif(btrim(o.nv_tao),''), nullif(btrim(o.nv_ban),''), '(trống)') AS nv,
               count(*)::int AS so_don,
               coalesce(sum(o.tong_sau_giam),0)::float AS tong_tien
        FROM ${fq('fact_don_hang_moi_nhat')} o
        WHERE o.ngay BETWEEN $1::date AND $2::date ${khoO}
          AND o.trang_thai_ten = 'canceled'
        GROUP BY 1
        ORDER BY so_don DESC, tong_tien DESC`,
        pKh
      )
    ).rows;

    // ---- NCC / PO ----
    let nccSafe = { so_po: 0, lead_time_tb: null, ty_le_nhan: null };
    try {
      nccSafe = (
        await c.query(
          `
          SELECT
            count(*)::int AS so_po,
            avg(
              CASE WHEN po.ngay_dat IS NOT NULL AND po.han_giao IS NOT NULL
                   THEN (po.han_giao - po.ngay_dat)
                   ELSE NULL END
            )::float AS lead_time_tb,
            CASE WHEN sum(coalesce(po.so_luong_dat,0))=0 THEN NULL
                 ELSE sum(coalesce(po.so_luong_da_nhan,0))::float
                      / nullif(sum(coalesce(po.so_luong_dat,0)),0)::float END AS ty_le_nhan
          FROM ${fq('fact_po_moi_nhat')} po
          WHERE coalesce(po.so_luong_dat,0) > 0`
        )
      ).rows[0];
    } catch (_) {
      /* ignore */
    }

    let maBoSafe = [];
    try {
      maBoSafe = (
        await c.query(
          `SELECT spu_key, coalesce(ten_san_pham, ghi_chu) AS ten_san_pham, ly_do
           FROM ${fq('vw_spu_loai_tru_doanh_thu')} ORDER BY spu_key`
        )
      ).rows;
    } catch (_) {
      maBoSafe = (
        await c.query(
          `SELECT spu_key, ten_san_pham, phan_khuc AS ly_do
           FROM ${fq('dim_spu')} WHERE phan_khuc = 'Dịch vụ/Đặt hàng' ORDER BY 1`
        )
      ).rows;
    }

    const dt = kpiCur.dt || 0;
    const dtTruoc = kpiPrev.dt || 0;
    const delta = dt - dtTruoc;

    return {
      from,
      to,
      prevFrom,
      prevTo,
      days,
      kpi: {
        dt,
        don: kpiCur.don,
        sl: kpiCur.sl,
        dt_truoc: dtTruoc,
        don_truoc: kpiPrev.don,
        sl_truoc: kpiPrev.sl,
        delta_dt: delta,
        delta_pct: dtTruoc ? delta / dtTruoc : null,
        tb_don: kpiCur.don ? dt / kpiCur.don : null,
      },
      bridge: {
        kho: bridgeKho,
        phan_khuc: bridgePk2,
        chung_loai: bridgeNhom,
      },
      khach: { ...khach, top: topKh },
      kenh: byKenh,
      khuyen_mai: km,
      van_hanh: {
        nv: byNv,
        tra_hang: traHang,
        don_huy_rows: donHuyRows,
        don_huy_by_nv: donHuyByNv,
        don_hoan_rows: donHoanRows,
        don_hoan_by_nv: donHoanByNv,
      },
      ncc: nccSafe,
      ma_bo_dt: maBoSafe,
      notes: {
        ads: 'Chi phí quảng cáo theo kênh chưa có trong Sapo — ROAS cần nhập tay/bảng ads.',
        gold: 'Giá vàng/bạc ngày chưa nạp — dùng bảng fact_gold_price (schema vietnam) khi có.',
        exclude: 'Doanh thu tổng đã loại Dịch vụ/Đặt hàng; Mã trung gian vẫn tính.',
        ky_truoc: `Kỳ này = ${from} → ${to} (${days} ngày). Kỳ trước = ${prevFrom} → ${prevTo} (cùng ${days} ngày liền trước, không phải tháng lịch).`,
        don_huy:
          'Hủy = canceled; Hoàn = Đã hoàn (returned) — khớp tab POS, không gộp Hoàn 1 phần. Đếm theo ngày tạo đơn (ngay). Ưu tiên NV tạo; trống thì NV bán.',
      },
    };
  });
}

/** Trang Tồn xấu đã đẩy — cohort snapshot + tiến độ đơn chốt sau chốt. */
async function dayTonXau(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    let snaps = [];
    try {
      snaps = (
        await c.query(
          `
          SELECT ngay_snapshot::text AS ngay_snapshot,
                 coalesce(ky_trong_thang::text, '') AS ky_trong_thang,
                 so_ma, so_ma_da_day, so_ma_chua_day,
                 ton_luc_chot::float, gt_luc_chot::float,
                 coalesce(sl_ban_sau_chot, 0)::float AS don_chot,
                 coalesce(dt_sau_chot, 0)::float AS dt_sau_chot,
                 ton_hien_tai::float,
                 ngay_kiem_tra::text AS ngay_kiem_tra
          FROM ${fq('vw_day_ton_xau_tong')}
          ORDER BY ngay_snapshot DESC`
        )
      ).rows;
    } catch (e) {
      return {
        from,
        to,
        snap: null,
        snapshots: [],
        kpi: null,
        rows: [],
        note: `Chưa có view vw_day_ton_xau_tong: ${e.message}`,
      };
    }

    let snap = q.ngay_snapshot || null;
    if (!snap) {
      // Ưu tiên kỳ chốt TRƯỚC ngày `to` để còn cửa sổ "sau chốt" đo đã đẩy
      const hit =
        snaps.find((s) => s.ngay_snapshot < to) ||
        snaps.find((s) => s.ngay_snapshot <= to) ||
        snaps[0];
      snap = hit ? hit.ngay_snapshot : null;
    }
    if (!snap) {
      return {
        from,
        to,
        snap: null,
        snapshots: [],
        kpi: null,
        rows: [],
        note: 'Chưa có snapshot tồn xấu — chạy chốt kỳ trước.',
      };
    }
    const tong = snaps.find((s) => s.ngay_snapshot === snap) || snaps[0] || null;

    const p = [snap];
    let statusWhere = '';
    if (q.trang_thai_day && q.trang_thai_day !== 'All') {
      statusWhere = ` AND v.trang_thai_day = ${pushParams(p, q.trang_thai_day)}`;
    }
    let khoWhere = '';
    if (q.kho && q.kho !== 'All') {
      khoWhere = ` AND v.kho = ${pushParams(p, q.kho)}`;
    }

    const rows = (
      await c.query(
        `
        SELECT v.spu_key,
               v.ten_san_pham,
               coalesce(v.kho, '') AS kho,
               v.ngay_snapshot::text AS ngay_snapshot,
               coalesce(v.ky_trong_thang::text, '') AS ky_trong_thang,
               v.ton_luc_chot::float,
               v.gt_luc_chot::float,
               coalesce(v.sl_ban_sau_chot, 0)::float AS don_chot,
               coalesce(v.dt_sau_chot, 0)::float AS dt_sau_chot,
               v.trang_thai_day,
               v.ton_hien_tai::float,
               v.sl_giam_ton::float
        FROM ${fq('vw_day_ton_xau')} v
        WHERE v.ngay_snapshot = $1::date ${statusWhere} ${khoWhere}
        ORDER BY
          v.kho,
          CASE WHEN v.trang_thai_day = 'Đã đẩy' THEN 0 ELSE 1 END,
          coalesce(v.sl_ban_sau_chot, 0) DESC,
          v.ton_luc_chot DESC,
          v.spu_key`,
        p
      )
    ).rows;

    let byKho = [];
    try {
      const pK = [snap];
      let stK = '';
      if (q.trang_thai_day && q.trang_thai_day !== 'All') {
        stK = ` AND v.trang_thai_day = ${pushParams(pK, q.trang_thai_day)}`;
      }
      byKho = (
        await c.query(
          `
          SELECT coalesce(v.kho, '—') AS kho,
                 count(*)::int AS so_ma,
                 count(*) FILTER (WHERE v.trang_thai_day = 'Đã đẩy')::int AS so_ma_da_day,
                 count(*) FILTER (WHERE v.trang_thai_day = 'Chưa đẩy')::int AS so_ma_chua_day,
                 coalesce(sum(v.ton_luc_chot), 0)::float AS ton_luc_chot,
                 coalesce(sum(v.gt_luc_chot), 0)::float AS gt_luc_chot,
                 coalesce(sum(v.sl_ban_sau_chot), 0)::float AS don_chot,
                 coalesce(sum(v.dt_sau_chot), 0)::float AS dt_sau_chot,
                 coalesce(sum(v.ton_hien_tai), 0)::float AS ton_hien_tai
          FROM ${fq('vw_day_ton_xau')} v
          WHERE v.ngay_snapshot = $1::date ${stK}
            AND coalesce(v.kho, '') <> ''
          GROUP BY v.kho
          ORDER BY v.kho`,
          pK
        )
      ).rows;
    } catch (_) {
      byKho = [];
    }

    const kpiFromRows = () => {
      const so_ma = rows.length;
      const so_ma_da_day = rows.filter((r) => r.trang_thai_day === 'Đã đẩy').length;
      return {
        so_ma,
        so_ma_da_day,
        so_ma_chua_day: so_ma - so_ma_da_day,
        ton_luc_chot: rows.reduce((s, r) => s + (Number(r.ton_luc_chot) || 0), 0),
        gt_luc_chot: rows.reduce((s, r) => s + (Number(r.gt_luc_chot) || 0), 0),
        don_chot: rows.reduce((s, r) => s + (Number(r.don_chot) || 0), 0),
        dt_sau_chot: rows.reduce((s, r) => s + (Number(r.dt_sau_chot) || 0), 0),
        ton_hien_tai: rows.reduce((s, r) => s + (Number(r.ton_hien_tai) || 0), 0),
        ngay_kiem_tra: tong?.ngay_kiem_tra || null,
        ky_trong_thang: tong?.ky_trong_thang || '',
        ty_le_day: so_ma ? so_ma_da_day / so_ma : null,
      };
    };

    return {
      from,
      to,
      snap,
      snapshots: snaps,
      kpi:
        q.kho && q.kho !== 'All'
          ? kpiFromRows()
          : tong
            ? {
                so_ma: tong.so_ma,
                so_ma_da_day: tong.so_ma_da_day,
                so_ma_chua_day: tong.so_ma_chua_day,
                ton_luc_chot: tong.ton_luc_chot,
                gt_luc_chot: tong.gt_luc_chot,
                don_chot: tong.don_chot,
                dt_sau_chot: tong.dt_sau_chot,
                ton_hien_tai: tong.ton_hien_tai,
                ngay_kiem_tra: tong.ngay_kiem_tra,
                ky_trong_thang: tong.ky_trong_thang,
                ty_le_day: tong.so_ma ? tong.so_ma_da_day / tong.so_ma : null,
              }
            : kpiFromRows(),
      byKho,
      rows,
      note: 'Tồn xấu chốt theo từng kho (Thái/Nhật tách). Đã đẩy = ≥1 đơn chốt sau snapshot tại đúng kho đó.',
    };
  });
}

/**
 * Phễu theo 3 trục ngày POS (khác bảng/cột):
 * - Chốt: fact_doanh_thu.ngay = Ngày chốt (analytics/sale)
 * - Xuất: fact_don_hang.ngay_xuat = lần đầu status shipped (2) trong status_history
 * - Thành công: fact_don_hang.ngay_thanh_cong = lần đầu status delivered (3)
 */
async function pheoDoanhThu(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const p = [from, to];
    const ff = factFilters(q, p, 'f');
    const dimKpi = ensureDimJoin(ff);

    const chot = (
      await c.query(
        `
      SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt,
             coalesce(sum(f.don_chot),0)::float AS don
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${dimKpi.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}
        ${notDichVuDt(dimKpi.dim)}`,
        p
      )
    ).rows[0];

    function orderExtraWhere(params) {
      let where = '';
      if (q.kho && q.kho !== 'All') where += ` AND o.kho = ${pushParams(params, q.kho)}`;
      if (q.trang_thai && q.trang_thai !== 'All') {
        where += ` AND o.trang_thai_ten = ${pushParams(params, q.trang_thai)}`;
      }
      const needDim =
        (q.phan_khuc && q.phan_khuc !== 'All') ||
        (q.phan_nhom && q.phan_nhom !== 'All') ||
        (q.ma_cu_moi && q.ma_cu_moi !== 'All') ||
        (q.spu && q.spu !== 'All');
      if (needDim) {
        const dimConds = [];
        if (q.spu && q.spu !== 'All') dimConds.push(`ct.spu_key = ${pushParams(params, q.spu)}`);
        if (q.phan_khuc && q.phan_khuc !== 'All') {
          dimConds.push(`d.phan_khuc = ${pushParams(params, q.phan_khuc)}`);
        }
        if (q.phan_nhom && q.phan_nhom !== 'All') {
          dimConds.push(`d.chung_loai = ${pushParams(params, q.phan_nhom)}`);
        }
        if (q.ma_cu_moi && q.ma_cu_moi !== 'All') {
          dimConds.push(
            `coalesce(nullif(btrim(d.ma_cu_moi),''),'Mã cũ') = ${pushParams(params, q.ma_cu_moi)}`
          );
        }
        where += `
          AND EXISTS (
            SELECT 1 FROM ${fq('fact_don_hang_ct_moi_nhat')} ct
            LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = ct.spu_key
            WHERE ct.order_id = o.order_id AND ${dimConds.join(' AND ')}
          )`;
      }
      return where;
    }

    const pXuat = [from, to];
    const whereXuat = orderExtraWhere(pXuat);
    const xuat = (
      await c.query(
        `
      SELECT coalesce(sum(o.tong_sau_giam),0)::float AS dt,
             count(*)::int AS don
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay_xuat BETWEEN $1::date AND $2::date ${whereXuat}`,
        pXuat
      )
    ).rows[0];

    const pTc = [from, to];
    const whereTc = orderExtraWhere(pTc);
    const thanhCong = (
      await c.query(
        `
      SELECT coalesce(sum(o.tong_sau_giam),0)::float AS dt,
             count(*)::int AS don
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay_thanh_cong BETWEEN $1::date AND $2::date ${whereTc}`,
        pTc
      )
    ).rows[0];

    const pHoan = [from, to];
    const whereHoan = orderExtraWhere(pHoan);
    const hoan = (
      await c.query(
        `
      SELECT coalesce(sum(o.tong_sau_giam),0)::float AS dt,
             count(*)::int AS don
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay BETWEEN $1::date AND $2::date ${whereHoan}
        AND o.trang_thai_ten IN ('returned','part_returned')`,
        pHoan
      )
    ).rows[0];

    const dtChot = chot?.dt || 0;
    const donChot = chot?.don || 0;
    const dtXuat = xuat?.dt || 0;
    const donXuat = xuat?.don || 0;
    const dtTc = thanhCong?.dt || 0;
    const donTc = thanhCong?.don || 0;

    const kpi = {
      dt_chot: dtChot,
      don_chot: donChot,
      dt_xuat: dtXuat,
      don_xuat: donXuat,
      dt_thanh_cong: dtTc,
      don_thanh_cong: donTc,
      ty_le_xuat_chot: dtChot ? dtXuat / dtChot : null,
      ty_le_tc_xuat: dtXuat ? dtTc / dtXuat : null,
      dt_hoan: hoan?.dt || 0,
      don_hoan: hoan?.don || 0,
    };

    const pct = (a, b) => (b ? a / b : null);
    const funnel = [
      {
        key: 'chot',
        label: 'Chốt',
        dt: dtChot,
        don: donChot,
        pct_tren: 1,
        roi_dt: null,
        roi_don: null,
      },
      {
        key: 'xuat',
        label: 'Xuất',
        dt: dtXuat,
        don: donXuat,
        pct_tren: pct(dtXuat, dtChot),
        roi_dt: Math.max(0, dtChot - dtXuat),
        roi_don: Math.max(0, donChot - donXuat),
      },
      {
        key: 'thanh_cong',
        label: 'Thành công',
        dt: dtTc,
        don: donTc,
        pct_tren: pct(dtTc, dtXuat),
        roi_dt: Math.max(0, dtXuat - dtTc),
        roi_don: Math.max(0, donXuat - donTc),
      },
    ];

    // Daily chart = [from,to]; trend/spark cần thêm 15 ngày trước `to` để so realtime
    function shiftYmd(ymd, days) {
      const d = new Date(`${ymd}T12:00:00+07:00`);
      d.setDate(d.getDate() + days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    // Độ dài kỳ lọc (inclusive) → kỳ trước liền kề cùng số ngày
    const periodDays =
      Math.round(
        (new Date(`${to}T12:00:00+07:00`) - new Date(`${from}T12:00:00+07:00`)) / 86400000
      ) + 1;
    const priorTo = shiftYmd(from, -1);
    let priorFrom = shiftYmd(from, -periodDays);
    if (priorFrom < SYNC_RANGE_MIN) priorFrom = SYNC_RANGE_MIN;
    const dailyFrom = priorFrom < from ? priorFrom : from;

    const pDailyChot = [dailyFrom, to];
    const ffDaily = factFilters(q, pDailyChot, 'f');
    const dimDaily = ensureDimJoin(ffDaily);
    const dailyChot = (
      await c.query(
        `
      SELECT f.ngay::text AS ngay, sum(f.order_revenue_vnd)::float AS dt_chot
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${dimDaily.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ffDaily.where}
        ${notDichVuDt(dimDaily.dim)}
      GROUP BY f.ngay ORDER BY f.ngay`,
        pDailyChot
      )
    ).rows;

    const pDailyXuat = [dailyFrom, to];
    const whereDailyXuat = orderExtraWhere(pDailyXuat);
    const dailyXuat = (
      await c.query(
        `
      SELECT o.ngay_xuat::text AS ngay,
             coalesce(sum(o.tong_sau_giam),0)::float AS dt_xuat
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay_xuat BETWEEN $1::date AND $2::date ${whereDailyXuat}
      GROUP BY o.ngay_xuat ORDER BY o.ngay_xuat`,
        pDailyXuat
      )
    ).rows;

    const pDailyTc = [dailyFrom, to];
    const whereDailyTc = orderExtraWhere(pDailyTc);
    const dailyTc = (
      await c.query(
        `
      SELECT o.ngay_thanh_cong::text AS ngay,
             coalesce(sum(o.tong_sau_giam),0)::float AS dt_thanh_cong
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay_thanh_cong BETWEEN $1::date AND $2::date ${whereDailyTc}
      GROUP BY o.ngay_thanh_cong ORDER BY o.ngay_thanh_cong`,
        pDailyTc
      )
    ).rows;

    const dayMap = new Map();
    for (const r of dailyChot) dayMap.set(r.ngay, { ngay: r.ngay, dt_chot: r.dt_chot, dt_xuat: 0, dt_thanh_cong: 0 });
    for (const r of dailyXuat) {
      const cur = dayMap.get(r.ngay) || { ngay: r.ngay, dt_chot: 0, dt_xuat: 0, dt_thanh_cong: 0 };
      cur.dt_xuat = r.dt_xuat;
      dayMap.set(r.ngay, cur);
    }
    for (const r of dailyTc) {
      const cur = dayMap.get(r.ngay) || { ngay: r.ngay, dt_chot: 0, dt_xuat: 0, dt_thanh_cong: 0 };
      cur.dt_thanh_cong = r.dt_thanh_cong;
      dayMap.set(r.ngay, cur);
    }
    const dailyAll = [...dayMap.values()].sort((a, b) => (a.ngay < b.ngay ? -1 : 1));
    const daily = dailyAll.filter((r) => r.ngay >= from && r.ngay <= to);

    function trendVsPrior(key) {
      const byDay = new Map(dailyAll.map((r) => [r.ngay, Number(r[key]) || 0]));
      // Spark + tổng kỳ hiện tại = từng ngày trong [from, to]
      const spark = [];
      let recent = 0;
      for (let day = from; day <= to; day = shiftYmd(day, 1)) {
        const v = byDay.get(day) || 0;
        spark.push(v);
        recent += v;
      }
      // Kỳ trước: cùng số ngày, kết thúc ngày trước `from`
      let prior = 0;
      for (let day = priorFrom; day <= priorTo; day = shiftYmd(day, 1)) {
        prior += byDay.get(day) || 0;
      }
      let pct = null;
      if (prior > 0) pct = (recent - prior) / prior;
      else if (recent > 0) pct = 1;
      return {
        pct,
        spark,
        recent,
        prior,
        period_days: periodDays,
        prior_from: priorFrom,
        prior_to: priorTo,
      };
    }
    const trend = {
      chot: trendVsPrior('dt_chot'),
      xuat: trendVsPrior('dt_xuat'),
      thanh_cong: trendVsPrior('dt_thanh_cong'),
      label: `vs ${periodDays} ngày trước`,
      period_days: periodDays,
      prior_from: priorFrom,
      prior_to: priorTo,
    };

    const pChua = [from, to];
    const whereChua = orderExtraWhere(pChua);
    const chuaXuatByStatus = (
      await c.query(
        `
      SELECT o.trang_thai_ten AS trang_thai,
             count(*)::int AS don,
             coalesce(sum(o.tong_sau_giam),0)::float AS dt
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay BETWEEN $1::date AND $2::date ${whereChua}
        AND o.ngay_xuat IS NULL
        AND o.trang_thai_ten IN ('waitting','submitted','new')
      GROUP BY 1
      ORDER BY don DESC`,
        pChua
      )
    ).rows;

    // bySpu: chốt theo Ngày chốt; xuất theo ngay_xuat; TC theo ngay_thanh_cong
    const pSpu = [from, to];
    let whereSpuDt = '';
    let whereSpuO = '';
    if (q.kho && q.kho !== 'All') {
      const k = pushParams(pSpu, q.kho);
      whereSpuDt += ` AND f.kho = ${k}`;
      whereSpuO += ` AND o.kho = ${k}`;
    }
    if (q.trang_thai && q.trang_thai !== 'All') {
      whereSpuO += ` AND o.trang_thai_ten = ${pushParams(pSpu, q.trang_thai)}`;
    }
    if (q.spu && q.spu !== 'All') {
      const s = pushParams(pSpu, q.spu);
      whereSpuDt += ` AND f.spu_key = ${s}`;
      whereSpuO += ` AND ct.spu_key = ${s}`;
    }
    const dimSpuJoin = ` LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = x.spu_key`;
    let dimSpuWhere = '';
    if (q.phan_khuc && q.phan_khuc !== 'All') {
      dimSpuWhere += ` AND d.phan_khuc = ${pushParams(pSpu, q.phan_khuc)}`;
    }
    if (q.phan_nhom && q.phan_nhom !== 'All') {
      dimSpuWhere += ` AND d.chung_loai = ${pushParams(pSpu, q.phan_nhom)}`;
    }
    if (q.ma_cu_moi && q.ma_cu_moi !== 'All') {
      dimSpuWhere += ` AND coalesce(nullif(btrim(d.ma_cu_moi),''),'Mã cũ') = ${pushParams(pSpu, q.ma_cu_moi)}`;
    }

    const bySpu = (
      await c.query(
        `
      WITH chot AS (
        SELECT f.spu_key,
               sum(f.order_revenue_vnd)::float AS dt_chot,
               sum(f.don_chot)::float AS don_chot
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
        WHERE f.ngay BETWEEN $1::date AND $2::date ${whereSpuDt}
          ${notDichVuDt('d')}
        GROUP BY f.spu_key
      ),
      xuat AS (
        SELECT z.spu_key,
               coalesce(sum(z.dt_line),0)::float AS dt_xuat,
               count(DISTINCT z.order_id)::int AS don_xuat
        FROM (
          SELECT ct.spu_key, o.order_id,
                 (o.tong_sau_giam / nullif(count(*) OVER (PARTITION BY o.order_id), 0))::float AS dt_line
          FROM ${fq('fact_don_hang_ct_moi_nhat')} ct
          JOIN ${fq('fact_don_hang_moi_nhat')} o ON o.order_id = ct.order_id
          WHERE o.ngay_xuat BETWEEN $1::date AND $2::date ${whereSpuO}
            AND ct.spu_key IS NOT NULL AND btrim(ct.spu_key) <> ''
        ) z
        GROUP BY z.spu_key
      ),
      tc AS (
        SELECT z.spu_key,
               coalesce(sum(z.dt_line),0)::float AS dt_thanh_cong,
               count(DISTINCT z.order_id)::int AS don_thanh_cong
        FROM (
          SELECT ct.spu_key, o.order_id,
                 (o.tong_sau_giam / nullif(count(*) OVER (PARTITION BY o.order_id), 0))::float AS dt_line
          FROM ${fq('fact_don_hang_ct_moi_nhat')} ct
          JOIN ${fq('fact_don_hang_moi_nhat')} o ON o.order_id = ct.order_id
          WHERE o.ngay_thanh_cong BETWEEN $1::date AND $2::date ${whereSpuO}
            AND ct.spu_key IS NOT NULL AND btrim(ct.spu_key) <> ''
        ) z
        GROUP BY z.spu_key
      ),
      hoan AS (
        SELECT z.spu_key,
               coalesce(sum(z.dt_line),0)::float AS dt_hoan,
               count(DISTINCT z.order_id)::int AS don_hoan
        FROM (
          SELECT ct.spu_key, o.order_id,
                 (o.tong_sau_giam / nullif(count(*) OVER (PARTITION BY o.order_id), 0))::float AS dt_line
          FROM ${fq('fact_don_hang_ct_moi_nhat')} ct
          JOIN ${fq('fact_don_hang_moi_nhat')} o ON o.order_id = ct.order_id
          WHERE o.ngay BETWEEN $1::date AND $2::date ${whereSpuO}
            AND o.trang_thai_ten IN ('returned','part_returned')
            AND ct.spu_key IS NOT NULL AND btrim(ct.spu_key) <> ''
        ) z
        GROUP BY z.spu_key
      ),
      wait AS (
        SELECT z.spu_key, count(DISTINCT z.order_id)::int AS don_waitting
        FROM (
          SELECT ct.spu_key, o.order_id
          FROM ${fq('fact_don_hang_ct_moi_nhat')} ct
          JOIN ${fq('fact_don_hang_moi_nhat')} o ON o.order_id = ct.order_id
          WHERE o.ngay BETWEEN $1::date AND $2::date ${whereSpuO}
            AND o.trang_thai_ten = 'waitting'
            AND ct.spu_key IS NOT NULL AND btrim(ct.spu_key) <> ''
        ) z
        GROUP BY z.spu_key
      ),
      po AS (
        SELECT po.spu_key,
               sum(po.so_luong_con_thieu)::float AS dang_ve
        FROM ${fq('fact_po_moi_nhat')} po
        WHERE coalesce(po.so_luong_con_thieu,0) > 0
          AND po.spu_key IS NOT NULL
        GROUP BY po.spu_key
      ),
      x AS (
        SELECT coalesce(c.spu_key, xu.spu_key, tc.spu_key, h.spu_key, w.spu_key) AS spu_key,
               coalesce(c.dt_chot,0)::float AS dt_chot,
               coalesce(c.don_chot,0)::float AS don_chot,
               coalesce(xu.dt_xuat,0)::float AS dt_xuat,
               coalesce(xu.don_xuat,0)::int AS don_xuat,
               coalesce(tc.dt_thanh_cong,0)::float AS dt_thanh_cong,
               coalesce(tc.don_thanh_cong,0)::int AS don_thanh_cong,
               coalesce(h.dt_hoan,0)::float AS dt_hoan,
               coalesce(h.don_hoan,0)::int AS don_hoan,
               coalesce(w.don_waitting,0)::int AS don_waitting,
               coalesce(po.dang_ve,0)::float AS dang_ve
        FROM chot c
        FULL OUTER JOIN xuat xu ON xu.spu_key = c.spu_key
        FULL OUTER JOIN tc ON tc.spu_key = coalesce(c.spu_key, xu.spu_key)
        FULL OUTER JOIN hoan h ON h.spu_key = coalesce(c.spu_key, xu.spu_key, tc.spu_key)
        FULL OUTER JOIN wait w ON w.spu_key = coalesce(c.spu_key, xu.spu_key, tc.spu_key, h.spu_key)
        LEFT JOIN po ON po.spu_key = coalesce(c.spu_key, xu.spu_key, tc.spu_key, h.spu_key, w.spu_key)
      )
      SELECT x.spu_key,
             coalesce(d.ten_san_pham,'') AS ten_san_pham,
             coalesce(d.phan_khuc,'') AS phan_khuc,
             x.dt_chot, x.don_chot, x.dt_xuat, x.don_xuat,
             x.dt_thanh_cong, x.don_thanh_cong, x.dt_hoan, x.don_hoan,
             CASE WHEN x.dt_chot = 0 THEN NULL ELSE x.dt_thanh_cong / x.dt_chot END AS ty_le_tc,
             (x.don_waitting > 0 AND x.dang_ve > 0) AS cho_hang_po
      FROM x
      ${dimSpuJoin}
      WHERE 1=1 ${dimSpuWhere}
        AND (x.dt_chot <> 0 OR x.dt_xuat <> 0 OR x.dt_thanh_cong <> 0 OR x.dt_hoan <> 0 OR x.don_waitting > 0)
      ORDER BY x.dt_chot DESC NULLS LAST
      LIMIT 200`,
        pSpu
      )
    ).rows;

    const pKhoDt = [from, to];
    const ffKho = factFilters(q, pKhoDt, 'f');
    const dimKho = ensureDimJoin(ffKho);

    const chotByKho = (
      await c.query(
        `
      SELECT f.kho,
             sum(f.order_revenue_vnd)::float AS dt_chot,
             sum(f.don_chot)::float AS don_chot
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${dimKho.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ffKho.where}
        ${notDichVuDt(dimKho.dim)}
      GROUP BY f.kho`,
        pKhoDt
      )
    ).rows;

    const pKhoXuat = [from, to];
    let whereKhoXuat = '';
    if (q.kho && q.kho !== 'All') whereKhoXuat += ` AND o.kho = ${pushParams(pKhoXuat, q.kho)}`;
    if (q.trang_thai && q.trang_thai !== 'All') {
      whereKhoXuat += ` AND o.trang_thai_ten = ${pushParams(pKhoXuat, q.trang_thai)}`;
    }
    const xuatByKho = (
      await c.query(
        `
      SELECT o.kho,
             coalesce(sum(o.tong_sau_giam),0)::float AS dt_xuat,
             count(*)::int AS don_xuat
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay_xuat BETWEEN $1::date AND $2::date ${whereKhoXuat}
      GROUP BY o.kho`,
        pKhoXuat
      )
    ).rows;

    const pKhoTc = [from, to];
    let whereKhoTc = '';
    if (q.kho && q.kho !== 'All') whereKhoTc += ` AND o.kho = ${pushParams(pKhoTc, q.kho)}`;
    if (q.trang_thai && q.trang_thai !== 'All') {
      whereKhoTc += ` AND o.trang_thai_ten = ${pushParams(pKhoTc, q.trang_thai)}`;
    }
    const tcByKho = (
      await c.query(
        `
      SELECT o.kho,
             coalesce(sum(o.tong_sau_giam),0)::float AS dt_thanh_cong,
             count(*)::int AS don_thanh_cong
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay_thanh_cong BETWEEN $1::date AND $2::date ${whereKhoTc}
      GROUP BY o.kho`,
        pKhoTc
      )
    ).rows;

    const pKhoHoan = [from, to];
    let whereKhoHoan = '';
    if (q.kho && q.kho !== 'All') whereKhoHoan += ` AND o.kho = ${pushParams(pKhoHoan, q.kho)}`;
    if (q.trang_thai && q.trang_thai !== 'All') {
      whereKhoHoan += ` AND o.trang_thai_ten = ${pushParams(pKhoHoan, q.trang_thai)}`;
    }
    const hoanByKho = (
      await c.query(
        `
      SELECT o.kho,
             coalesce(sum(o.tong_sau_giam),0)::float AS dt_hoan,
             count(*)::int AS don_hoan
      FROM ${fq('fact_don_hang_moi_nhat')} o
      WHERE o.ngay BETWEEN $1::date AND $2::date ${whereKhoHoan}
        AND o.trang_thai_ten IN ('returned','part_returned')
      GROUP BY o.kho`,
        pKhoHoan
      )
    ).rows;

    const khoMap = new Map();
    const ensureKho = (kho) => {
      if (!khoMap.has(kho)) {
        khoMap.set(kho, {
          kho,
          dt_chot: 0,
          don_chot: 0,
          dt_xuat: 0,
          don_xuat: 0,
          dt_thanh_cong: 0,
          don_thanh_cong: 0,
          dt_hoan: 0,
          don_hoan: 0,
        });
      }
      return khoMap.get(kho);
    };
    for (const r of chotByKho) {
      const cur = ensureKho(r.kho);
      cur.dt_chot = r.dt_chot || 0;
      cur.don_chot = r.don_chot || 0;
    }
    for (const r of xuatByKho) {
      const cur = ensureKho(r.kho);
      cur.dt_xuat = r.dt_xuat || 0;
      cur.don_xuat = r.don_xuat || 0;
    }
    for (const r of tcByKho) {
      const cur = ensureKho(r.kho);
      cur.dt_thanh_cong = r.dt_thanh_cong || 0;
      cur.don_thanh_cong = r.don_thanh_cong || 0;
    }
    for (const r of hoanByKho) {
      const cur = ensureKho(r.kho);
      cur.dt_hoan = r.dt_hoan || 0;
      cur.don_hoan = r.don_hoan || 0;
    }
    const byKho = [...khoMap.values()]
      .map((r) => ({
        ...r,
        ty_le_tc: r.dt_chot ? r.dt_thanh_cong / r.dt_chot : null,
      }))
      .sort((a, b) => b.dt_chot - a.dt_chot);

    return {
      from,
      to,
      kpi,
      funnel,
      daily,
      trend,
      chuaXuatByStatus,
      bySpu,
      byKho,
      note: '3 trục ngày POS: Chốt=fact_doanh_thu.ngay; Xuất=fact_don_hang.ngay_xuat (status shipped); TC=ngay_thanh_cong (status delivered).',
    };
  });
}

module.exports = {
  overview,
  sanPham,
  tonKho,
  hangDangVe,
  hanhDong,
  spuCheck,
  filterOptions,
  phanTichDoanhThu,
  dayTonXau,
  pheoDoanhThu,
};
