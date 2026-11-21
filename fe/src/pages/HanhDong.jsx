import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmt } from '../lib/format';
import BadgePk from '../components/BadgePk';
import DataTable from '../components/DataTable';

function ActionTable({ title, pack }) {
  const t = pack.total || {};
  return (
    <div className="card" style={{ minHeight: 'auto', marginBottom: 14 }}>
      <h2>{title}</h2>
      <DataTable
        searchPlaceholder="Tìm SPU…"
        rows={pack.rows || []}
        columns={[
          { key: 'spu_key', label: 'SPU', search: true },
          { key: 'ten_san_pham', label: 'Tên sản phẩm' },
          { key: 'phan_khuc', label: 'Phân khúc', render: (r) => <BadgePk pk={r.phan_khuc} /> },
          { key: 'kho', label: 'Kho' },
          { key: 'ton_sl', label: 'Tồn cuối kỳ (SL)', className: 'num', sort: true, sortValue: (r) => r.ton_sl, render: (r) => fmt.num(r.ton_sl) },
          { key: 'ton_gt', label: 'GT tồn', className: 'num', sort: true, sortValue: (r) => r.ton_gt, render: (r) => fmt.moneyFull(r.ton_gt) },
          { key: 'dt', label: 'Doanh thu', className: 'num', sort: true, sortValue: (r) => r.dt, render: (r) => fmt.moneyFull(r.dt) },
          { key: 'sl_ban', label: 'SL bán', className: 'num', sort: true, sortValue: (r) => r.sl_ban, render: (r) => fmt.num(r.sl_ban) },
          { key: 'dang_ve', label: 'Hàng đang về', className: 'num', sort: true, sortValue: (r) => r.dang_ve, render: (r) => fmt.num(r.dang_ve) },
          { key: 'goi_y', label: 'Gợi ý' },
        ]}
        footer={[
          { content: 'Tổng', colSpan: 4 },
          { content: fmt.num(t.ton_sl), className: 'num' },
          { content: fmt.moneyFull(t.ton_gt), className: 'num' },
          { content: fmt.moneyFull(t.dt), className: 'num' },
          { content: fmt.num(t.sl_ban), className: 'num' },
          { content: fmt.num(t.dang_ve), className: 'num' },
          { content: '' },
        ]}
      />
    </div>
  );
}

export default function HanhDong({ filters }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    api('/api/hanh-dong', filters)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e.message || e)));
    return () => {
      live = false;
    };
  }, [filters]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Đang tải…</div>;

  return (
    <>
      <ActionTable title="Ưu tiên về hàng / giữ stock (Bán chạy)" pack={data.banChay} />
      <ActionTable title="Xả tồn / cắt đặt (Tồn xấu)" pack={data.tonXau} />
      <ActionTable title="Theo dõi (Bán chậm)" pack={data.banCham} />
    </>
  );
}
