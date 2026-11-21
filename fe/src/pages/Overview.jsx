import { memo, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { fmt } from '../lib/format';
import { bar, doughnut, line } from '../lib/charts';
import BadgePk from '../components/BadgePk';
import ChartCanvas from '../components/ChartCanvas';
import DataTable from '../components/DataTable';
import Kpi from '../components/Kpi';

function Overview({ filters }) {
  const { data, error, loading } = useApi('/api/overview', filters);
  const [lookup, setLookup] = useState('');
  const [lookupHtml, setLookupHtml] = useState(null);

  useEffect(() => {
    const q = lookup.trim();
    if (!q) {
      setLookupHtml(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api(`/api/spu-check?key=${encodeURIComponent(q)}`, filters);
        if (!res.found) {
          setLookupHtml(
            <span>
              <b>{q}</b> — <span className="danger">không có trong dim_spu</span>
            </span>
          );
          return;
        }
        setLookupHtml(
          <span>
            {res.rows.map((r, i) => (
              <span key={r.spu_key || i}>
                {i ? <br /> : null}
                <b>{r.spu_key}</b> · {r.ten_san_pham || ''} · <BadgePk pk={r.phan_khuc} /> ·{' '}
                {r.tinh_vao_tong ? (
                  <span className="tag-ok">GIỮ trong Tổng SPU</span>
                ) : (
                  <span className="tag-danger">BỎ khỏi Tổng SPU</span>
                )}
                {r.bo_thu_cong ? ' (thủ công)' : ''}
              </span>
            ))}
          </span>
        );
      } catch (e) {
        setLookupHtml(String(e.message || e));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [lookup, filters]);

  const drawKho = useCallback(
    (canvas) => {
      if (!data) return;
      bar(
        canvas,
        data.byKho.map((r) => r.kho.replace('KHO ', '')),
        data.byKho.map((r) => r.dt),
        { horizontal: true, color: '#252e80', thick: true, maxBarThickness: 56 }
      );
    },
    [data]
  );
  const drawMa = useCallback(
    (canvas) => {
      if (!data) return;
      doughnut(
        canvas,
        data.byMa.map((r) => r.ma_cu_moi),
        data.byMa.map((r) => r.dt),
        ['#1e3a8a', '#0f766e', '#64748b'],
        { legendNamesOnly: true }
      );
    },
    [data]
  );
  const drawDay = useCallback(
    (canvas) => {
      if (!data) return;
      line(
        canvas,
        data.daily.map((r) => r.ngay.slice(8) + '/' + r.ngay.slice(5, 7)),
        data.daily.map((r) => r.dt),
        data.kpi.benchmark
      );
    },
    [data]
  );

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;

  const k = data.kpi;
  const m = data.spuMeta || {};

  return (
    <div className={loading ? 'is-loading' : ''}>
      <div className="kpi-row">
        <Kpi label="Tổng SPU" value={fmt.num(k.so_spu)} />
        <Kpi label="Doanh thu" value={fmt.money(k.dt)} />
        <Kpi label="Đơn chốt" value={fmt.num(k.don)} />
        <Kpi label="Số lượng bán" value={fmt.num(k.sl)} />
        <Kpi label="Giá trị TB/đơn" value={fmt.moneyFull(k.tb_don)} />
        <Kpi label="DT mã trung gian" value={fmt.money(k.dt_trung_gian)} tone="warn" />
        <Kpi label="SL quá hạn" value={fmt.num(k.sl_qua_han)} tone="danger" />
        <Kpi label="Hàng đang về" value={fmt.num(k.hang_dang_ve)} tone="ok" />
      </div>
      <div className="grid-3">
        <div className="card">
          <h2>Doanh thu theo kho</h2>
          <ChartCanvas draw={drawKho} tall />
        </div>
        <div className="card">
          <h2>Tỷ trọng mã cũ và mã mới</h2>
          <ChartCanvas draw={drawMa} tall />
        </div>
        <div className="card">
          <h2>Doanh thu theo ngày</h2>
          <ChartCanvas draw={drawDay} tall />
        </div>
      </div>
      <div className="card">
        <h2>Chi tiết theo kho</h2>
        <DataTable
          rows={data.byKho}
          columns={[
            { key: 'kho', label: 'Kho' },
            { key: 'dt', label: 'Doanh thu', className: 'num', sort: true, sortValue: (r) => r.dt, render: (r) => fmt.moneyFull(r.dt) },
            { key: 'don', label: 'Đơn', className: 'num', sort: true, sortValue: (r) => r.don, render: (r) => fmt.num(r.don) },
            { key: 'sl', label: 'SL', className: 'num', sort: true, sortValue: (r) => r.sl, render: (r) => fmt.num(r.sl) },
            { key: 'tb_don', label: 'TB/đơn', className: 'num', sort: true, sortValue: (r) => r.tb_don, render: (r) => fmt.moneyFull(r.tb_don) },
          ]}
        />
      </div>
      <div className="card">
        <h2>Tổng SPU — đang giữ / đang bỏ</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <label className="muted">Tra mã</label>
          <input
            type="text"
            placeholder="C500391"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, minWidth: 160 }}
          />
          <span className="muted">{lookupHtml}</span>
        </div>
        <div className="grid-2">
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Theo phân khúc</h3>
            <DataTable
              rows={m.byPk || []}
              columns={[
                { key: 'phan_khuc', label: 'Phân khúc', render: (r) => <BadgePk pk={r.phan_khuc} /> },
                { key: 'so_ma', label: 'Số mã', className: 'num', render: (r) => fmt.num(r.so_ma) },
              ]}
            />
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Danh sách đang bỏ ({fmt.num((m.bo || []).length)})</h3>
            <DataTable
              rows={m.bo || []}
              columns={[
                {
                  key: 'spu_key',
                  label: 'SPU',
                  render: (r) => (
                    <>
                      {r.spu_key}
                      {r.bo_thu_cong ? (
                        <>
                          {' '}
                          <span className="tag-danger">thủ công</span>
                        </>
                      ) : null}
                    </>
                  ),
                },
                { key: 'ten_san_pham', label: 'Tên' },
                { key: 'loai_ma', label: 'Loại mã' },
                { key: 'phan_khuc', label: 'Phân khúc', render: (r) => <BadgePk pk={r.phan_khuc} /> },
                { key: 'dt', label: 'Doanh số', className: 'num', sort: true, sortValue: (r) => r.dt, render: (r) => fmt.moneyFull(r.dt) },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(Overview);
