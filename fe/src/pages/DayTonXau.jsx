import { memo, useEffect } from 'react';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import DataTable from '../components/DataTable';
import Kpi from '../components/Kpi';

function badgeDay(status) {
  const s = status || '';
  if (s === 'Đã đẩy') return <span className="badge badge-ok">{s}</span>;
  return <span className="badge badge-warn">{s || '—'}</span>;
}

function DayTonXau({ filters, onSnapChange, onStatusChange }) {
  const { data, error, loading } = useApi('/api/day-ton-xau', filters);

  useEffect(() => {
    if (data?.snap && !filters.ngay_snapshot && onSnapChange) onSnapChange(data.snap);
  }, [data?.snap, filters.ngay_snapshot, onSnapChange]);

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;

  const k = data.kpi || {};
  const status = filters.trang_thai_day || 'All';

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="inline-filters">
        <label>
          Kỳ chốt (1 / 15 / cuối tháng)
          <select value={data.snap || ''} onChange={(e) => onSnapChange?.(e.target.value)}>
            {(data.snapshots || []).length ? (
              (data.snapshots || []).map((s) => {
                const ky = s.ky_trong_thang ? ` · ${s.ky_trong_thang}` : '';
                return (
                  <option key={s.ngay_snapshot} value={s.ngay_snapshot}>
                    {s.ngay_snapshot}
                    {ky} ({s.so_ma_da_day}/{s.so_ma})
                  </option>
                );
              })
            ) : (
              <option value="">—</option>
            )}
          </select>
        </label>
        <label>
          Trạng thái
          <select value={status} onChange={(e) => onStatusChange?.(e.target.value)}>
            <option value="All">Tất cả</option>
            <option value="Đã đẩy">Đã đẩy</option>
            <option value="Chưa đẩy">Chưa đẩy</option>
          </select>
        </label>
      </div>

      <div className="kpi-row">
        <Kpi label="Số mã cohort" value={fmt.num(k.so_ma)} />
        <Kpi label="Đã đẩy" value={fmt.num(k.so_ma_da_day)} tone="ok" sub={fmt.pct(k.ty_le_day)} />
        <Kpi label="Chưa đẩy" value={fmt.num(k.so_ma_chua_day)} tone="warn" />
        <Kpi label="Đơn chốt sau chốt" value={fmt.num(k.don_chot)} />
        <Kpi label="DT sau chốt" value={fmt.money(k.dt_sau_chot)} />
        <Kpi
          label="Tồn lúc chốt"
          value={fmt.num(k.ton_luc_chot)}
          sub={`GT ${fmt.money(k.gt_luc_chot)} · hiện ${fmt.num(k.ton_hien_tai)}`}
        />
      </div>

      {(data.byKho || []).length > 0 ? (
        <div className="kpi-row">
          {(data.byKho || []).map((r) => (
            <Kpi
              key={r.kho}
              label={`${String(r.kho || '').replace(/^KHO\s+/i, '')} · tồn xấu`}
              value={fmt.num(r.so_ma)}
              sub={`tồn ${fmt.num(r.ton_luc_chot)} · GT ${fmt.money(r.gt_luc_chot)} · đẩy ${fmt.num(r.so_ma_da_day)}`}
            />
          ))}
        </div>
      ) : null}

      <div className="card table-card">
        <h2>Chi tiết cohort · snapshot {data.snap || '—'}</h2>
        <DataTable
          searchPlaceholder="Tìm SPU…"
          className="tall"
          rows={data.rows || []}
          columns={[
            { key: 'spu_key', label: 'SPU', search: true },
            { key: 'ten_san_pham', label: 'Tên sản phẩm' },
            { key: 'kho', label: 'Kho' },
            { key: 'ky_trong_thang', label: 'Kỳ' },
            { key: 'trang_thai_day', label: 'Trạng thái', render: (r) => badgeDay(r.trang_thai_day) },
            {
              key: 'ton_luc_chot',
              label: 'Tồn lúc chốt',
              className: 'num',
              sort: true,
              sortValue: (r) => r.ton_luc_chot,
              render: (r) => fmt.num(r.ton_luc_chot),
            },
            {
              key: 'gt_luc_chot',
              label: 'GT lúc chốt',
              className: 'num',
              sort: true,
              sortValue: (r) => r.gt_luc_chot,
              render: (r) => fmt.moneyFull(r.gt_luc_chot),
            },
            {
              key: 'don_chot',
              label: 'Đơn chốt TD',
              className: 'num',
              sort: true,
              sortValue: (r) => r.don_chot,
              render: (r) => fmt.num(r.don_chot),
            },
            {
              key: 'dt_sau_chot',
              label: 'DT sau chốt',
              className: 'num',
              sort: true,
              sortValue: (r) => r.dt_sau_chot,
              render: (r) => fmt.moneyFull(r.dt_sau_chot),
            },
            {
              key: 'ton_hien_tai',
              label: 'Tồn hiện',
              className: 'num',
              sort: true,
              sortValue: (r) => r.ton_hien_tai,
              render: (r) => fmt.num(r.ton_hien_tai),
            },
            {
              key: 'sl_giam_ton',
              label: 'SL giảm tồn',
              className: 'num',
              sort: true,
              sortValue: (r) => r.sl_giam_ton,
              render: (r) => fmt.num(r.sl_giam_ton),
            },
          ]}
        />
      </div>
    </div>
  );
}

export default memo(DayTonXau);
