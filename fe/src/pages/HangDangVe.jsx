import { memo, useCallback } from 'react';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import { bar, doughnut } from '../lib/charts';
import ChartCanvas from '../components/ChartCanvas';
import DataTable from '../components/DataTable';
import Kpi from '../components/Kpi';

function etaClass(flag) {
  if (flag === 'Quá hạn') return 'eta-qh';
  if (flag === 'Sắp đến hạn') return 'eta-sh';
  return 'eta-ch';
}

function HangDangVe({ filters }) {
  const { data, error, loading } = useApi('/api/hang-dang-ve', filters);

  const drawEta = useCallback(
    (canvas) => {
      if (!data) return;
      const k = data.kpi;
      doughnut(canvas, ['Quá hạn', 'Sắp đến hạn', 'Còn hạn'], [k.qua_han, k.sap_han, k.con_han], ['#dc2626', '#ea580c', '#16a34a'], {
        format: 'num',
        legendNamesOnly: true,
      });
    },
    [data]
  );
  const drawSpu = useCallback(
    (canvas) => {
      if (!data) return;
      bar(
        canvas,
        data.bySpu.map((r) => r.spu_key),
        data.bySpu.map((r) => r.sl),
        { horizontal: true, color: '#0f766e', format: 'num' }
      );
    },
    [data]
  );

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;
  const k = data.kpi;

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="kpi-row">
        <Kpi label="Số PO" value={fmt.num(k.so_po)} />
        <Kpi label="Hàng đang về" value={fmt.num(k.dang_ve)} tone="ok" />
        <Kpi label="SL quá hạn" value={fmt.num(k.qua_han)} tone="danger" />
        <Kpi label="SL sắp đến hạn (≤7 ngày)" value={fmt.num(k.sap_han)} tone="warn" />
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Hàng đang về by Flag ETA</h2>
          <ChartCanvas draw={drawEta} />
        </div>
        <div className="card">
          <h2>Hàng đang về theo SPU</h2>
          <ChartCanvas draw={drawSpu} />
        </div>
      </div>
      <div className="card">
        <h2>Chi tiết PO</h2>
        <DataTable
          searchPlaceholder="Tìm SPU…"
          rows={data.rows}
          columns={[
            {
              key: 'flag_eta',
              label: 'Flag ETA',
              render: (r) => <span className={`badge ${etaClass(r.flag_eta)}`}>{r.flag_eta}</span>,
            },
            { key: 'han_giao', label: 'Hạn giao' },
            { key: 'ma_po', label: 'Mã PO', search: true },
            { key: 'spu_key', label: 'SPU', search: true },
            { key: 'sku', label: 'SKU', search: true },
            { key: 'phan_khuc', label: 'Phân khúc' },
            { key: 'dang_ve', label: 'Hàng đang về', className: 'num', sort: true, sortValue: (r) => r.dang_ve, render: (r) => fmt.num(r.dang_ve) },
            { key: 'nha_cung_cap', label: 'NCC' },
          ]}
        />
      </div>
    </div>
  );
}

export default memo(HangDangVe);
