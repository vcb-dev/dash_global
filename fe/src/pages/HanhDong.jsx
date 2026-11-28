import { memo, useEffect, useMemo } from 'react';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import BadgePk from '../components/BadgePk';
import DataTable from '../components/DataTable';
import Kpi from '../components/Kpi';

const CANH_BAO_CLASS = {
  'Thiếu hàng': 'stock-thieu',
  'Sắp hết hàng': 'stock-sap-het',
  'Còn hàng': 'stock-con',
};

const CANH_BAO_RANK = {
  'Thiếu hàng': 0,
  'Sắp hết hàng': 1,
  'Còn hàng': 2,
};

function BadgeStock({ status }) {
  const s = status || '—';
  return <span className={`badge ${CANH_BAO_CLASS[s] || ''}`}>{s}</span>;
}

function countCanhBao(rows) {
  const out = { thieu: 0, sapHet: 0, con: 0 };
  for (const r of rows || []) {
    if (r.canh_bao === 'Thiếu hàng') out.thieu += 1;
    else if (r.canh_bao === 'Sắp hết hàng') out.sapHet += 1;
    else out.con += 1;
  }
  return out;
}

function ActionTable({ title, pack, showStockAlert = true }) {
  const t = pack.total || {};
  const rows = pack.rows || [];
  const soMa = t.so_ma != null ? t.so_ma : rows.length;
  const cb = useMemo(() => countCanhBao(rows), [rows]);
  const columns = useMemo(() => {
    const cols = [
      { key: 'spu_key', label: 'SPU', search: true },
      { key: 'ten_san_pham', label: 'Tên sản phẩm' },
      { key: 'phan_khuc', label: 'Phân khúc', render: (r) => <BadgePk pk={r.phan_khuc} /> },
      { key: 'kho', label: 'Kho' },
      {
        key: 'ton_sl',
        label: 'Tồn hiện',
        className: 'num',
        sort: true,
        sortValue: (r) => r.ton_sl,
        render: (r) => fmt.num(r.ton_sl),
      },
      {
        key: 'ton_gt',
        label: 'GT tồn',
        className: 'num',
        sort: true,
        sortValue: (r) => r.ton_gt,
        render: (r) => fmt.moneyFull(r.ton_gt),
      },
      {
        key: 'dt',
        label: 'DT sau chốt',
        className: 'num',
        sort: true,
        sortValue: (r) => r.dt,
        render: (r) => fmt.moneyFull(r.dt),
      },
      {
        key: 'sl_ban',
        label: 'SL sau chốt',
        className: 'num',
        sort: true,
        sortValue: (r) => r.sl_ban,
        render: (r) => fmt.num(r.sl_ban),
      },
      {
        key: 'sl_30',
        label: 'SL 30n chốt',
        className: 'num',
        sort: true,
        sortValue: (r) => (r.sl_30 != null ? r.sl_30 : r.don_30),
        render: (r) => fmt.num(r.sl_30 != null ? r.sl_30 : r.don_30),
      },
    ];
    if (showStockAlert) {
      cols.push({
        key: 'canh_bao',
        label: 'Cảnh báo tồn',
        sort: true,
        sortValue: (r) => CANH_BAO_RANK[r.canh_bao] ?? 9,
        render: (r) => {
          const sl30 = r.sl_30 != null ? r.sl_30 : r.don_30;
          const cover =
            r.cover_days != null && Number.isFinite(Number(r.cover_days))
              ? `~${fmt.num(r.cover_days, 0)} ngày`
              : '—';
          return (
            <div className="stock-alert-cell">
              <BadgeStock status={r.canh_bao} />
              <div className="muted stock-alert-sub">
                chốt {fmt.num(sl30)} · tồn {fmt.num(r.ton_sl)} · {cover}
              </div>
            </div>
          );
        },
      });
    }
    cols.push(
      {
        key: 'dang_ve',
        label: 'Hàng đang về',
        className: 'num',
        sort: true,
        sortValue: (r) => r.dang_ve,
        render: (r) => fmt.num(r.dang_ve),
      },
      { key: 'goi_y', label: 'Gợi ý' }
    );
    return cols;
  }, [showStockAlert]);

  const footer = [
    { content: `Tổng ${fmt.num(soMa)} mã`, colSpan: 4 },
    { content: fmt.num(t.ton_sl), className: 'num' },
    { content: fmt.moneyFull(t.ton_gt), className: 'num' },
    { content: fmt.moneyFull(t.dt), className: 'num' },
    { content: fmt.num(t.sl_ban), className: 'num' },
    { content: '' },
  ];
  if (showStockAlert) {
    footer.push({
      content: `${fmt.num(cb.thieu)} thiếu · ${fmt.num(cb.sapHet)} sắp hết`,
      className: 'muted',
    });
  }
  footer.push({ content: fmt.num(t.dang_ve), className: 'num' }, { content: '' });

  return (
    <div className="card table-card" style={{ minHeight: 'auto', marginBottom: 14 }}>
      <div className="table-card-head">
        <h2>{title}</h2>
        <div className="table-card-meta muted">
          <span>
            {fmt.num(soMa)} mã · tồn {fmt.num(t.ton_sl)} · GT {fmt.moneyFull(t.ton_gt)}
          </span>
          {showStockAlert && soMa ? (
            <span className="stock-alert-summary">
              <span className="badge stock-thieu">{fmt.num(cb.thieu)} thiếu</span>
              <span className="badge stock-sap-het">{fmt.num(cb.sapHet)} sắp hết</span>
              <span className="badge stock-con">{fmt.num(cb.con)} còn</span>
            </span>
          ) : null}
        </div>
      </div>
      <DataTable searchPlaceholder="Tìm SPU…" rows={rows} columns={columns} footer={footer} />
    </div>
  );
}

function HanhDong({ filters, onSnapChange }) {
  const { data, error, loading } = useApi('/api/hanh-dong', filters);

  useEffect(() => {
    if (data?.snap && !filters.ngay_snapshot && onSnapChange) onSnapChange(data.snap);
  }, [data?.snap, filters.ngay_snapshot, onSnapChange]);

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;

  const ky = data.ky || {};

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="inline-filters">
        <label>
          Kỳ chốt (1 / 15 / cuối tháng)
          <select value={data.snap || ''} onChange={(e) => onSnapChange?.(e.target.value)}>
            {(data.snapshots || []).length ? (
              (data.snapshots || []).map((s) => (
                <option key={s.ngay_snapshot} value={s.ngay_snapshot}>
                  {s.ky_label || s.ngay_snapshot}
                </option>
              ))
            ) : (
              <option value="">—</option>
            )}
          </select>
        </label>
      </div>

      <div className="kpi-row">
        <Kpi
          label="Kỳ đang xem"
          value={ky.ky_trong_thang || '—'}
          className="kpi-text"
          sub={data.snap || ''}
        />
        <Kpi
          label="Cửa sổ SL 30n chốt"
          value={`${ky.tu_ngay_30 || '—'} → ${ky.den_ngay_30 || '—'}`}
          className="kpi-text"
        />
        <Kpi
          label="Theo dõi realtime"
          value={`${data.snap || '—'} → ${data.to || '—'}`}
          tone="ok"
          className="kpi-text"
          sub={`DT/SL sau chốt · Tồn ${data.asOf || '—'}`}
        />
      </div>

      <ActionTable
        title="Ưu tiên về hàng / giữ stock (Bán chạy + Bán thường tại chốt)"
        pack={data.banChay || { rows: [] }}
      />
      <ActionTable title="Theo dõi (Bán chậm tại chốt)" pack={data.banCham || { rows: [] }} />
      <ActionTable
        title="Xả tồn / cắt đặt (Tồn xấu tại chốt)"
        pack={data.tonXau || { rows: [] }}
        showStockAlert={false}
      />
    </div>
  );
}

export default memo(HanhDong);
