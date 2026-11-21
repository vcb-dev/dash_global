/**
 * Chỉnh theo ảnh chuẩn user gửi — không đụng Page 1.
 * - Sản phẩm: treemap|bảng SPU / bar|cảnh báo mã trung gian (tách rõ)
 * - Tồn kho pivot: title rõ là GIÁ TRỊ (không phải SL)
 */
const fs = require('fs');
const path = require('path');

const RP = path.join(__dirname, 'Pancake_Supabase.Report', 'definition', 'pages');
const SP = '0da433e99042dd26e0ed';
const TK = 'a71cfc684b8c80c00094';
const M = 24;
const G = 16;
const W = 1920;
const H = 1080;
const CW = W - M * 2;

function read(page, id) {
  return JSON.parse(fs.readFileSync(path.join(RP, page, 'visuals', id, 'visual.json'), 'utf8'));
}
function write(page, id, obj) {
  const dir = path.join(RP, page, 'visuals', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'visual.json'), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function setPos(v, x, y, w, h, z) {
  v.position = { x, y, z: z ?? v.position.z, height: h, width: w, tabOrder: z ?? v.position.tabOrder };
  return v;
}
function textbox(id, x, y, w, h, z, text, fontSize, color) {
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
    name: id,
    position: { x, y, z, height: h, width: w, tabOrder: z },
    visual: {
      visualType: 'textbox',
      objects: {
        general: [
          {
            properties: {
              paragraphs: [
                {
                  textRuns: [
                    {
                      value: text,
                      textStyle: {
                        fontFamily: 'Segoe UI Semibold',
                        fontSize: fontSize || '14pt',
                        color: color || '#1B3A4B',
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  };
}

// ===== SẢN PHẨM =====
const half = Math.floor((CW - G) / 2);
const titleH = 40;
const topY = 56;
const topH = 420;
const botY = topY + topH + 36;
const botH = H - botY - M;

write(SP, 'sptitle000000000001', textbox('sptitle000000000001', M, 12, 700, titleH, 0, 'Sản phẩm và phân khúc', '22pt'));

// keep date slicer if exists — park top right
try {
  const sl = read(SP, '7c2b15a43eab0bd10c30');
  write(SP, '7c2b15a43eab0bd10c30', setPos(sl, 1560, 8, 336, 44, 1));
} catch (_) {}

write(SP, '89be2bd83ce74560060c', setPos(read(SP, '89be2bd83ce74560060c'), M, topY, half, topH, 2));
write(SP, 'splabeltable0000001', textbox('splabeltable0000001', M + half + G, topY - 28, half, 24, 3, 'Chi tiết SPU (đã loại mã trung gian / dịch vụ)', '12pt', '#475569'));
write(SP, 'edddc563490c3a43c418', setPos(read(SP, 'edddc563490c3a43c418'), M + half + G, topY, half, topH, 4));

write(SP, '72f80b800630b1c0a89d', setPos(read(SP, '72f80b800630b1c0a89d'), M, botY, half, botH, 5));
write(
  SP,
  'spwarnlabel00000001',
  textbox('spwarnlabel00000001', M + half + G, botY - 28, half, 24, 6, '⚠ Cảnh báo — DT ghi trên mã trung gian (chưa map SKU)', '12pt', '#B45309')
);
write(SP, '1b332c4762b586e50366', setPos(read(SP, '1b332c4762b586e50366'), M + half + G, botY, half, botH, 7));

console.log('Sản phẩm layout fixed');

// ===== TỒN KHO: title pivot rõ là giá trị =====
const pivot = read(TK, '6a480d5157298e0ba005');
if (pivot.visual.visualContainerObjects && pivot.visual.visualContainerObjects.title) {
  const t = pivot.visual.visualContainerObjects.title[0];
  if (t && t.properties && t.properties.text) {
    t.properties.text.expr.Literal.Value = "'Giá trị tồn theo phân khúc × kho'";
  }
}
write(TK, '6a480d5157298e0ba005', pivot);
console.log('Tồn kho pivot title clarified');

console.log('Done — Page 1 untouched');
