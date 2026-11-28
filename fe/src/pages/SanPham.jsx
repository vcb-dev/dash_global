import { memo, useCallback } from 'react';
import { useChartFilter } from '../lib/chartFilter';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import { barLineShare, doughnut } from '../lib/charts';
import BadgePk from '../components/BadgePk';
import ChartCanvas from '../components/ChartCanvas';
import DataTable from '../components/DataTable';
import Kpi from '../components/Kpi';

function SanPham({ filters }) {
  const applyChartFilter = useChartFilter();
  const { data, error, loading } = useApi('/api/san-pham', filters);

  const drawPk = useCallback(
    (canvas) => {
      if (!data) return;
      doughnut(
        canvas,
        data.byPk.map((r) => r.phan_khuc),
        data.byPk.map((r) => r.dt),
        ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0f766e', '#64748b'],
        {
          legendNamesOnly: true,
          onClick: (label) => applyChartFilter({ phan_khuc: label }),
        }
      );
    },
    [data, applyChartFilter]
  );
  const drawNhom = useCallback(
    (canvas) => {
      if (!data) return;
      barLineShare(
        canvas,
        data.byNhom.map((r) => r.nhom),
        data.byNhom.map((r) => r.dt),
        data.byNhom.map((r) => r.ty_trong_pct),
        { onClick: (label) => applyChartFilter({ phan_nhom: label }) }
      );
    },
    [data, applyChartFilter]
  );

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="kpi-row">
        <Kpi label="⚠ Doanh thu mã trung gian" value={fmt.money(data.warn_dt)} tone="warn" />
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Doanh thu theo phân khúc</h2>
          <ChartCanvas draw={drawPk} tall />
        </div>
        <div className="card">
          <h2>Doanh thu theo phân nhóm</h2>
          <ChartCanvas draw={drawNhom} tall />
        </div>
      </div>
      <div className="card">
        <h2>Top sản phẩm</h2>
        <DataTable
          searchPlaceholder="Tìm SPU…"
          rows={data.top || []}
          columns={[
            { key: 'phan_khuc', label: 'Phân khúc', render: (r) => <BadgePk pk={r.phan_khuc} /> },
            { key: 'spu_key', label: 'SPU', search: true },
            { key: 'spunew', label: 'SPU new', search: true, render: (r) => r.spunew || '' },
            { key: 'ten_san_pham', label: 'Tên sản phẩm' },
            { key: 'dt', label: 'Doanh thu', className: 'num', sort: true, sortValue: (r) => r.dt, render: (r) => fmt.moneyFull(r.dt) },
            { key: 'sl', label: 'SL bán', className: 'num', sort: true, sortValue: (r) => r.sl, render: (r) => fmt.num(r.sl) },
          ]}
        />
      </div>
    </div>
  );
}

export default memo(SanPham);
