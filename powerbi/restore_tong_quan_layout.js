/**
 * Trả Tổng quan về layout trước khi add alert (khớp ảnh user ~11:28).
 * Xóa các visual cảnh báo vừa thêm. Không đụng Page 1 / trang khác.
 */
const fs = require('fs');
const path = require('path');

const TQ = path.join(
  __dirname,
  'Pancake_Supabase.Report',
  'definition',
  'pages',
  '67a13695837b0e0c0e20',
  'visuals'
);

function read(id) {
  return JSON.parse(fs.readFileSync(path.join(TQ, id, 'visual.json'), 'utf8'));
}
function write(id, v) {
  fs.writeFileSync(path.join(TQ, id, 'visual.json'), JSON.stringify(v, null, 2) + '\n', 'utf8');
}
function setPos(v, x, y, w, h) {
  v.position.x = x;
  v.position.y = y;
  v.position.width = w;
  v.position.height = h;
  return v;
}

// Remove alert visuals I added
for (const id of [
  'tqalertlabel0000001',
  'tqalerttg0000000001',
  'tqalertqh0000000001',
  'tqalerthv0000000001',
]) {
  const dir = path.join(TQ, id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('removed', id);
  }
}

// Restore positions from user's polished screenshot era (pre-alert script)
write('1d45c967e417921c08c0', setPos(read('1d45c967e417921c08c0'), 25, 154, 1872, 150));
write('0680a5d2318698338e07', setPos(read('0680a5d2318698338e07'), 25, 304, 1020, 318));
write('5bc2c3dfed501a50102b', setPos(read('5bc2c3dfed501a50102b'), 1055, 304, 840, 318));
write('2af42e63010275c51a11', setPos(read('2af42e63010275c51a11'), 24, 632, 1872, 424));

console.log('Tổng quan layout restored to pre-alert positions');
