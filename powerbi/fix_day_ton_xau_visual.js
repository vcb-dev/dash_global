// Sửa bảng chi tiết tồn xấu trên bản nháp: bỏ filter B001268 / Tồn xấu rolling, dùng list chốt.
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  'Pancake_Supabase_BanNhap.Report/definition/pages/a71cfc684b8c80c00094/visuals/ba5ef9553a2a55bc3030/visual.json'
);
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
j.filterConfig = {
  filters: [
    {
      name: 'daytxau_spu_filter01',
      field: { Column: { Expression: { SourceRef: { Entity: 'day_ton_xau' } }, Property: 'spu_key' } },
      type: 'Categorical',
    },
    {
      name: 'daytxau_ten_filter01',
      field: { Column: { Expression: { SourceRef: { Entity: 'day_ton_xau' } }, Property: 'ten_san_pham' } },
      type: 'Categorical',
    },
    {
      name: 'daytxau_tt_filter01',
      field: { Column: { Expression: { SourceRef: { Entity: 'day_ton_xau' } }, Property: 'trang_thai_day' } },
      type: 'Categorical',
    },
  ],
};
fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
console.log('Updated filterConfig on', file);
