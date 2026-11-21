const MAP = {
  'Tồn xấu': 'xau',
  'Bán chạy': 'chay',
  'Bán chậm': 'cham',
  'Bán thường': 'thuong',
};

export default function BadgePk({ pk }) {
  return <span className={`badge ${MAP[pk] || ''}`}>{pk || ''}</span>;
}
