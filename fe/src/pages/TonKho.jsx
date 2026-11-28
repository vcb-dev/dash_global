import { memo, useCallback, useMemo } from 'react';
import { useChartFilter } from '../lib/chartFilter';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import { bar } from '../lib/charts';
import BadgePk from '../components/BadgePk';
import ChartCanvas from '../components/ChartCanvas';
import DataTable from '../components/DataTable';
import Kpi from '../components/Kpi';

function TonKho({ filters }) {
  const applyChartFilter = useChartFilter();
  const { data, error, loading } = useApi('/api/ton-kho', filters);

  const pks = useMemo(() => (data ? [...new Set(data.matrix.map((r) => r.phan_khuc))] : []), [data]);
  const khos = useMemo(() => (data ? [...new Set(data.matrix.map((r) => r.kho))] : []), [data]);

  const drawKho = useCallback(
    (canvas) => {
      if (!data) return;
      bar(
        canvas,
        data.byKho.map((r) => r.kho.replace('KHO ', '')),
        data.byKho.map((r) => r.gt),
        {
          horizontal: true,
          color: '#1d4ed8',
          onClick: (label) => applyChartFilter({ kho: label }),
        }
      );
    },
    [data, applyChartFilter]
  );

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;

  const cell = (kho, pk) => data.matrix.find((r) => r.kho === kho && r.phan_khuc === pk);

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="kpi-row">
        <Kpi label="Giá trị tồn cuối kỳ" value={fmt.moneyFull(data.kpi.gt)} />
        <Kpi label="Số lượng tồn cuối kỳ" value={fmt.num(data.kpi.sl)} />
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Giá trị tồn theo kho</h2>
          <ChartCanvas draw={drawKho} />
        </div>
        <div className="card">
          <h2>Phân khúc theo kho</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Kho</th>
                  {pks.map((p) => (
                    <th key={p} className="num">
                      {p}
                    </th>
                  ))}
                  <th className="num">Tổng SL</th>
                </tr>
              </thead>
              <tbody>
                {khos.map((kho) => {
                  let sum = 0;
                  return (
                    <tr key={kho}>
                      <td>{kho}</td>
                      {pks.map((pk) => {
                        const c = cell(kho, pk);
                        const sl = c ? Number(c.sl) : 0;
                        sum += sl;
                        return (
                          <td key={pk} className="num">
                            {c ? (
                              <>
                                {fmt.num(c.sl)}
                                <div className="muted">{fmt.money(c.gt)}</div>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                      <td className="num">
                        <b>{fmt.num(sum)}</b>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {(data.tonXauByKho || []).length > 0 ? (
        <div className="kpi-row">
          {(data.tonXauByKho || []).map((r) => (
            <Kpi
              key={r.kho}
              label={`Tồn xấu · ${String(r.kho || '').replace(/^KHO\s+/i, '')}`}
              value={fmt.num(r.so_ma)}
              sub={`SL ${fmt.num(r.sl)} · GT ${fmt.moneyFull(r.gt)}`}
              tone="warn"
            />
          ))}
        </div>
      ) : null}

      <div className="card">
        <h2>Chi tiết tồn xấu (theo từng kho)</h2>
        <DataTable
          searchPlaceholder="Tìm SPU…"
          rows={data.tonXau}
          columns={[
            { key: 'spu_key', label: 'SPU', search: true },
            { key: 'ten_san_pham', label: 'Tên sản phẩm' },
            { key: 'phan_khuc', label: 'Phân khúc', render: (r) => <BadgePk pk={r.phan_khuc} /> },
            { key: 'chung_loai', label: 'Phân nhóm' },
            { key: 'kho', label: 'Kho' },
            { key: 'sl', label: 'Tồn cuối kỳ (SL)', className: 'num', sort: true, sortValue: (r) => r.sl, render: (r) => fmt.num(r.sl) },
            { key: 'gt', label: 'GT tồn', className: 'num', sort: true, sortValue: (r) => r.gt, render: (r) => fmt.moneyFull(r.gt) },
          ]}
        />
      </div>
    </div>
  );
}

export default memo(TonKho);
