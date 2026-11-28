import { memo, useCallback, useMemo, useState } from 'react';
import { useChartFilter } from '../lib/chartFilter';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import { doughnut, multiLine } from '../lib/charts';
import ChartCanvas from '../components/ChartCanvas';
import DataTable from '../components/DataTable';
import FunnelVisual from '../components/FunnelVisual';
import SparkKpi from '../components/SparkKpi';

const STATUS_LABEL = {
  waitting: 'Waiting',
  submitted: 'Submitted',
  new: 'New',
};

function rateBar(pct, tone = 'navy') {
  const w = Math.max(0, Math.min(100, (Number(pct) || 0) * 100));
  return (
    <div className="kpi-bar">
      <div className={`kpi-bar-fill tone-${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function PheuDoanhThu({ filters }) {
  const applyChartFilter = useChartFilter();
  const { data, error, loading } = useApi('/api/pheu-doanh-thu', filters);
  const [tableMode, setTableMode] = useState('spu');

  const drawDaily = useCallback(
    (canvas) => {
      if (!data?.daily?.length) return;
      multiLine(
        canvas,
        data.daily.map((r) => r.ngay),
        [
          { label: 'Chốt', values: data.daily.map((r) => r.dt_chot), color: '#5b4cdb' },
          { label: 'Xuất', values: data.daily.map((r) => r.dt_xuat), color: '#3b82f6' },
          { label: 'Thành công', values: data.daily.map((r) => r.dt_thanh_cong), color: '#22c55e' },
        ],
        { onClick: (label) => applyChartFilter({ day: label }) }
      );
    },
    [data, applyChartFilter]
  );

  const chuaXuat = useMemo(() => {
    const rows = data?.chuaXuatByStatus || [];
    const don = rows.reduce((s, r) => s + (r.don || 0), 0);
    const dt = rows.reduce((s, r) => s + (r.dt || 0), 0);
    return { rows, don, dt };
  }, [data]);

  const drawChuaXuat = useCallback(
    (canvas) => {
      if (!data) return;
      const rows = chuaXuat.rows;
      const labels = rows.map((r) => STATUS_LABEL[r.trang_thai] || r.trang_thai);
      const values = rows.map((r) => r.don);
      doughnut(canvas, labels, values, ['#5b4cdb', '#93c5fd', '#c4b5fd'], {
        format: 'num',
        legendNamesOnly: true,
        center: fmt.num(chuaXuat.don),
        centerSub: `${fmt.pct(data.kpi?.don_chot ? chuaXuat.don / data.kpi.don_chot : null)} tổng chốt`,
        onClick: (label) => applyChartFilter({ trang_thai: label }),
      });
    },
    [data, chuaXuat, applyChartFilter]
  );

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;
  const k = data.kpi || {};
  const trend = data.trend || {};
  const compareHint = trend.label || 'vs kỳ trước';

  const funnelStages = [
    {
      key: 'chot',
      label: 'chốt',
      title: 'DT chốt',
      dt: k.dt_chot || 0,
      don: k.don_chot || 0,
      pct_tren: 1,
    },
    {
      key: 'xuat',
      label: 'xuất',
      title: 'DT xuất',
      dt: k.dt_xuat || 0,
      don: k.don_xuat || 0,
      pct_tren: k.ty_le_xuat_chot,
    },
    {
      key: 'thanh_cong',
      label: 'thành công',
      title: 'DT thành công',
      dt: k.dt_thanh_cong || 0,
      don: k.don_thanh_cong || 0,
      pct_tren: k.ty_le_tc_xuat,
    },
  ];

  // Callout 1: ưu tiên đơn chốt chưa xuất (doughnut); fallback chênh chốt−xuất
  const dropChuaXuatDt = chuaXuat.dt || Math.max(0, (k.dt_chot || 0) - (k.dt_xuat || 0));
  const dropChuaXuatDon = chuaXuat.don || Math.max(0, (k.don_chot || 0) - (k.don_xuat || 0));
  const dropGiaoDt = Math.max(0, (k.dt_xuat || 0) - (k.dt_thanh_cong || 0));
  const dropGiaoDon = Math.max(0, (k.don_xuat || 0) - (k.don_thanh_cong || 0));
  const funnelDrops = [
    dropChuaXuatDon > 0 || dropChuaXuatDt > 0
      ? {
          dt: dropChuaXuatDt,
          don: dropChuaXuatDon,
          label: 'Đơn chưa xuất',
          hint: 'Chờ hàng, Chờ xử lý…',
        }
      : (k.dt_xuat || 0) > (k.dt_chot || 0)
        ? {
            dt: (k.dt_xuat || 0) - (k.dt_chot || 0),
            don: Math.max(0, (k.don_xuat || 0) - (k.don_chot || 0)),
            label: 'Xuất vượt chốt',
            hint: 'Khác trục ngày (xuất kỳ này · chốt kỳ trước)',
            overflow: true,
          }
        : null,
    dropGiaoDon > 0 || dropGiaoDt > 0
      ? {
          dt: dropGiaoDt,
          don: dropGiaoDon,
          label: 'Đang giao hoặc hoàn',
          hint: 'Shipping, Returned…',
        }
      : null,
  ];

  const spuCols = [
    {
      key: 'spu_key',
      label: 'SPU',
      search: true,
      render: (r) => (
        <button type="button" className="linkish" onClick={() => applyChartFilter({ spu: r.spu_key })}>
          {r.spu_key}
          {r.cho_hang_po ? <span className="tag-po"> chờ hàng PO</span> : null}
        </button>
      ),
    },
    { key: 'ten_san_pham', label: 'Tên SP' },
    {
      key: 'dt_chot',
      label: 'DT chốt',
      className: 'num',
      sort: true,
      sortValue: (r) => r.dt_chot,
      render: (r) => fmt.moneyFull(r.dt_chot),
    },
    {
      key: 'dt_xuat',
      label: 'DT xuất',
      className: 'num',
      sort: true,
      sortValue: (r) => r.dt_xuat,
      render: (r) => fmt.moneyFull(r.dt_xuat),
    },
    {
      key: 'dt_thanh_cong',
      label: 'DT TC',
      className: 'num',
      sort: true,
      sortValue: (r) => r.dt_thanh_cong,
      render: (r) => fmt.moneyFull(r.dt_thanh_cong),
    },
    {
      key: 'ty_le_tc',
      label: '% TC',
      className: 'num',
      sort: true,
      sortValue: (r) => r.ty_le_tc,
      render: (r) => fmt.pct(r.ty_le_tc),
    },
    {
      key: 'dt_hoan',
      label: '% hoàn',
      className: 'num',
      sort: true,
      sortValue: (r) => (r.dt_chot ? r.dt_hoan / r.dt_chot : null),
      render: (r) => fmt.pct(r.dt_chot ? r.dt_hoan / r.dt_chot : null),
    },
  ];

  const khoCols = [
    {
      key: 'kho',
      label: 'Kho',
      render: (r) => (
        <button type="button" className="linkish" onClick={() => applyChartFilter({ kho: r.kho })}>
          {r.kho}
        </button>
      ),
    },
    {
      key: 'dt_chot',
      label: 'DT chốt',
      className: 'num',
      sort: true,
      sortValue: (r) => r.dt_chot,
      render: (r) => fmt.moneyFull(r.dt_chot),
    },
    {
      key: 'dt_xuat',
      label: 'DT xuất',
      className: 'num',
      sort: true,
      sortValue: (r) => r.dt_xuat,
      render: (r) => fmt.moneyFull(r.dt_xuat),
    },
    {
      key: 'dt_thanh_cong',
      label: 'DT TC',
      className: 'num',
      sort: true,
      sortValue: (r) => r.dt_thanh_cong,
      render: (r) => fmt.moneyFull(r.dt_thanh_cong),
    },
    {
      key: 'ty_le_tc',
      label: '% TC',
      className: 'num',
      sort: true,
      sortValue: (r) => r.ty_le_tc,
      render: (r) => fmt.pct(r.ty_le_tc),
    },
    {
      key: 'dt_hoan',
      label: '% hoàn',
      className: 'num',
      sort: true,
      sortValue: (r) => (r.dt_chot ? r.dt_hoan / r.dt_chot : null),
      render: (r) => fmt.pct(r.dt_chot ? r.dt_hoan / r.dt_chot : null),
    },
  ];

  return (
    <div className={`page-stack pheo-page${loading ? ' is-loading' : ''}`}>
      <div className="kpi-row kpi-row-5">
        <SparkKpi
          label="DT chốt"
          icon="▦"
          value={fmt.money(k.dt_chot)}
          sub={`${fmt.num(k.don_chot)} đơn`}
          color="#5b4cdb"
          pct={trend.chot?.pct}
          spark={trend.chot?.spark || []}
          compareHint={compareHint}
        />
        <SparkKpi
          label="DT xuất"
          icon="↗"
          value={fmt.money(k.dt_xuat)}
          sub={`${fmt.num(k.don_xuat)} đơn`}
          color="#3b82f6"
          pct={trend.xuat?.pct}
          spark={trend.xuat?.spark || []}
          compareHint={compareHint}
        />
        <SparkKpi
          label="DT thành công"
          icon="✓"
          tone="ok"
          value={fmt.money(k.dt_thanh_cong)}
          sub={`${fmt.num(k.don_thanh_cong)} đơn`}
          color="#22c55e"
          pct={trend.thanh_cong?.pct}
          spark={trend.thanh_cong?.spark || []}
          compareHint={compareHint}
        />
        <div className="kpi">
          <div className="kpi-head">
            <span className="label">Tỷ lệ xuất/chốt</span>
            <span className="kpi-ico" aria-hidden>
              %
            </span>
          </div>
          <div className="value">{fmt.pct(k.ty_le_xuat_chot)}</div>
          <div className="kpi-sub">
            {fmt.num(k.don_xuat)}/{fmt.num(k.don_chot)} đơn
          </div>
          {rateBar(k.ty_le_xuat_chot, 'navy')}
        </div>
        <div className="kpi">
          <div className="kpi-head">
            <span className="label">Tỷ lệ thành công/xuất</span>
            <span className="kpi-ico" aria-hidden>
              %
            </span>
          </div>
          <div className="value">{fmt.pct(k.ty_le_tc_xuat)}</div>
          <div className="kpi-sub">
            {fmt.num(k.don_thanh_cong)}/{fmt.num(k.don_xuat)} đơn
          </div>
          {rateBar(k.ty_le_tc_xuat, 'ok')}
        </div>
      </div>

      <div className="grid-2 pheo-mid">
        <div className="card">
          <h2>Phễu doanh thu</h2>
          <FunnelVisual stages={funnelStages} drops={funnelDrops} />
        </div>
        <div className="card">
          <h2>Doanh thu theo ngày</h2>
          <ChartCanvas draw={drawDaily} tall />
        </div>
      </div>

      <div className="grid-2 pheo-bottom">
        <div className="card">
          <h2>Chốt nhưng chưa xuất</h2>
          <ChartCanvas draw={drawChuaXuat} />
        </div>
        <div className="card table-card">
          <div className="table-card-head">
            <h2>Theo {tableMode === 'spu' ? 'SPU' : 'Kho'}</h2>
            <div className="seg">
              <button
                type="button"
                className={`seg-btn ${tableMode === 'spu' ? 'on' : ''}`}
                onClick={() => setTableMode('spu')}
              >
                SPU
              </button>
              <button
                type="button"
                className={`seg-btn ${tableMode === 'kho' ? 'on' : ''}`}
                onClick={() => setTableMode('kho')}
              >
                Kho
              </button>
            </div>
          </div>
          <DataTable
            searchPlaceholder={tableMode === 'spu' ? 'Tìm SPU…' : 'Tìm kho…'}
            rows={tableMode === 'spu' ? data.bySpu || [] : data.byKho || []}
            columns={tableMode === 'spu' ? spuCols : khoCols}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(PheuDoanhThu);
