import { memo, useCallback } from 'react';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import { bar } from '../lib/charts';
import ChartCanvas from '../components/ChartCanvas';
import DataTable from '../components/DataTable';
import Kpi from '../components/Kpi';

function deltaNode(v, asMoney = true) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  const cls = n > 0 ? 'delta-up' : n < 0 ? 'delta-down' : '';
  const sign = n > 0 ? '+' : '';
  const body = asMoney ? fmt.moneyFull(n) : fmt.num(n);
  return <span className={cls}>{`${sign}${body}`}</span>;
}

function PhanTichDt({ filters }) {
  const { data, error, loading } = useApi('/api/phan-tich-dt', filters);

  const drawKenh = useCallback(
    (canvas) => {
      if (!data?.kenh?.length) return;
      bar(
        canvas,
        data.kenh.map((r) => r.kenh),
        data.kenh.map((r) => r.dt),
        { horizontal: true, color: '#252e80', thick: true, maxBarThickness: 40 }
      );
    },
    [data]
  );
  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;

  const k = data.kpi || {};
  const kh = data.khach || {};
  const km = data.khuyen_mai || {};
  const vh = data.van_hanh || {};
  const tra = vh.tra_hang || {};
  const ncc = data.ncc || {};
  const notes = data.notes || {};
  const deltaCls = (k.delta_dt || 0) < 0 ? 'danger' : (k.delta_dt || 0) > 0 ? 'ok' : '';

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="kpi-row">
        <Kpi
          label="Doanh thu kỳ"
          value={fmt.money(k.dt)}
          tone={deltaCls}
          sub={
            <>
              trước {fmt.money(k.dt_truoc)} · {deltaNode(k.delta_dt)} ({fmt.pct(k.delta_pct)})
            </>
          }
        />
        <Kpi
          label="Đơn chốt"
          value={fmt.num(k.don)}
          sub={
            <>
              trước {fmt.num(k.don_truoc)} · {deltaNode((k.don || 0) - (k.don_truoc || 0), false)}
            </>
          }
        />
        <Kpi label="SL bán" value={fmt.num(k.sl)} sub={`trước ${fmt.num(k.sl_truoc)}`} />
        <Kpi
          label="TB / đơn"
          value={fmt.moneyFull(k.tb_don)}
          sub={`${data.days || '—'} ngày · so ${data.prevFrom || ''} → ${data.prevTo || ''}`}
        />
        <Kpi
          label="Retention (KH ≥2 đơn)"
          value={fmt.pct(kh.ty_le_retention)}
          sub={`${fmt.num(kh.kh_quay_lai)} / ${fmt.num(kh.so_kh)} KH`}
        />
        <Kpi label="Tỷ lệ giảm giá" value={fmt.pct(km.ty_le_giam)} tone="warn" sub={`giảm ${fmt.money(km.giam_gia)}`} />
      </div>

      <div className="pt-section">
        <h3 className="pt-section-title">Khách hàng</h3>
        <div className="card">
          <h2>Top KH theo doanh thu</h2>
          <DataTable
            rows={kh.top || []}
            columns={[
              { key: 'ten', label: 'KH', render: (r) => r.ten || r.kh_key || '' },
              { key: 'phone', label: 'SĐT' },
              { key: 'so_don', label: 'Số đơn', className: 'num', sort: true, sortValue: (r) => r.so_don, render: (r) => fmt.num(r.so_don) },
              { key: 'dt', label: 'DT', className: 'num', sort: true, sortValue: (r) => r.dt, render: (r) => fmt.moneyFull(r.dt) },
            ]}
          />
        </div>
      </div>

      <div className="pt-section">
        <h3 className="pt-section-title">Kênh bán</h3>
        <div className="grid-2">
          <div className="card">
            <h2>DT theo kênh (kỳ)</h2>
            <ChartCanvas draw={drawKenh} tall />
          </div>
          <div className="card">
            <h2>So kỳ trước</h2>
            <p className="muted section-hint">{notes.ky_truoc || ''}</p>
            <p className="muted section-hint">{notes.ads || ''}</p>
            <p className="muted section-hint">{notes.trong || ''}</p>
            <DataTable
              rows={data.kenh || []}
              columns={[
                { key: 'kenh', label: 'Kênh' },
                { key: 'dt', label: 'DT', className: 'num', sort: true, sortValue: (r) => r.dt, render: (r) => fmt.moneyFull(r.dt) },
                {
                  key: 'dt_truoc',
                  label: 'DT trước',
                  className: 'num',
                  sort: true,
                  sortValue: (r) => r.dt_truoc,
                  render: (r) => fmt.moneyFull(r.dt_truoc),
                },
                {
                  key: 'delta_dt',
                  label: 'Δ DT',
                  className: 'num',
                  sort: true,
                  sortValue: (r) => r.delta_dt,
                  render: (r) => deltaNode(r.delta_dt),
                },
                { key: 'don', label: 'Đơn', className: 'num', sort: true, sortValue: (r) => r.don, render: (r) => fmt.num(r.don) },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="pt-section">
        <h3 className="pt-section-title">Giá & khuyến mãi</h3>
        <div className="kpi-row">
          <Kpi label="Giá niêm yết" value={fmt.money(km.gia_niem_yet)} />
          <Kpi label="Giá bán thực" value={fmt.money(km.gia_ban)} />
          <Kpi label="Tổng giảm" value={fmt.money(km.giam_gia)} tone="warn" />
          <Kpi label="Tỷ lệ giảm" value={fmt.pct(km.ty_le_giam)} />
        </div>
      </div>

      <div className="pt-section">
        <h3 className="pt-section-title">Vận hành cửa hàng</h3>
        <div className="grid-2">
          <div className="card">
            <h2>NV bán — top DT</h2>
            <DataTable
              rows={vh.nv || []}
              columns={[
                { key: 'nv', label: 'NV' },
                { key: 'don', label: 'Đơn', className: 'num', sort: true, sortValue: (r) => r.don, render: (r) => fmt.num(r.don) },
                { key: 'dt', label: 'DT', className: 'num', sort: true, sortValue: (r) => r.dt, render: (r) => fmt.moneyFull(r.dt) },
              ]}
            />
          </div>
          <div className="card">
            <h2>Đơn chốt / hủy / hoàn</h2>
            <div className="kpi-row compact">
              <Kpi label="Đơn chốt" value={fmt.num(tra.don_chot)} tone="ok" />
              <Kpi label="Đơn hủy" value={fmt.num(tra.don_huy)} tone="danger" />
              <Kpi
                label="Đơn hoàn"
                value={fmt.num(tra.don_hoan)}
                tone="warn"
                sub={
                  tra.don_hoan_1p
                    ? `Hoàn 1 phần (POS): ${fmt.num(tra.don_hoan_1p)} — không gộp`
                    : 'Khớp tab POS Đã hoàn'
                }
              />
            </div>
            <p className="muted section-hint">{notes.don_huy || ''}</p>
            <DataTable
              searchPlaceholder="Tìm NV…"
              rows={vh.don_huy_by_nv || []}
              columns={[
                { key: 'nv', label: 'NV tạo / bán', search: true },
                {
                  key: 'so_don',
                  label: 'Số đơn hủy',
                  className: 'num',
                  sort: true,
                  sortValue: (r) => r.so_don,
                  render: (r) => fmt.num(r.so_don),
                },
                {
                  key: 'tong_tien',
                  label: 'Tổng tiền phiếu',
                  className: 'num',
                  sort: true,
                  sortValue: (r) => r.tong_tien,
                  render: (r) => fmt.moneyFull(r.tong_tien),
                },
              ]}
            />
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 14 }}>
          <div className="card">
            <h2>Chi tiết đơn hủy</h2>
            <DataTable
              searchPlaceholder="Tìm mã đơn / NV…"
              className="tall"
              rows={vh.don_huy_rows || []}
              columns={[
                { key: 'ngay', label: 'Ngày', sort: true, sortValue: (r) => r.ngay },
                { key: 'order_id', label: 'Mã đơn', search: true },
                { key: 'kho', label: 'Kho' },
                { key: 'nv_tao', label: 'NV tạo', search: true },
                { key: 'nv_ban', label: 'NV bán', search: true },
                { key: 'kenh', label: 'Kênh' },
                { key: 'khach', label: 'KH' },
                {
                  key: 'tong_tien',
                  label: 'Tiền phiếu',
                  className: 'num',
                  sort: true,
                  sortValue: (r) => r.tong_tien,
                  render: (r) => fmt.moneyFull(r.tong_tien),
                },
              ]}
            />
          </div>
          <div className="card">
            <h2>Chi tiết đơn hoàn</h2>
            <DataTable
              searchPlaceholder="Tìm mã đơn / NV…"
              className="tall"
              rows={vh.don_hoan_rows || []}
              columns={[
                { key: 'ngay', label: 'Ngày', sort: true, sortValue: (r) => r.ngay },
                { key: 'order_id', label: 'Mã đơn', search: true },
                { key: 'kho', label: 'Kho' },
                { key: 'trang_thai', label: 'TT' },
                { key: 'nv_tao', label: 'NV tạo', search: true },
                { key: 'nv_ban', label: 'NV bán', search: true },
                { key: 'kenh', label: 'Kênh' },
                {
                  key: 'tong_tien',
                  label: 'Tiền phiếu',
                  className: 'num',
                  sort: true,
                  sortValue: (r) => r.tong_tien,
                  render: (r) => fmt.moneyFull(r.tong_tien),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="pt-section">
        <h3 className="pt-section-title">Nhà cung cấp & yếu tố ngoài</h3>
        <div className="kpi-row">
          <Kpi label="Số PO" value={fmt.num(ncc.so_po)} />
          <Kpi label="Lead time TB (ngày)" value={ncc.lead_time_tb != null ? fmt.num(ncc.lead_time_tb, 1) : '—'} />
          <Kpi label="Tỷ lệ nhận / đặt" value={fmt.pct(ncc.ty_le_nhan)} />
          <Kpi label="Giá vàng ngày" value="—" sub={notes.gold || ''} />
        </div>
      </div>
    </div>
  );
}

export default memo(PhanTichDt);
