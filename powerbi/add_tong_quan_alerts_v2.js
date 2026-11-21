/**
 * CHỈ sửa Tổng quan điều hành: chèn hàng cảnh báo 3 KPI.
 * Không đụng Page 1 / Sản phẩm / Tồn / Hàng về / Hành động.
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
function write(v) {
  const dir = path.join(TQ, v.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'visual.json'), JSON.stringify(v, null, 2) + '\n', 'utf8');
}
function setPos(v, x, y, w, h) {
  v.position.x = x;
  v.position.y = y;
  v.position.width = w;
  v.position.height = h;
  return v;
}

function card(id, x, y, w, h, z, entity, measure) {
  return {
    $schema:
      'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
    name: id,
    position: { x, y, z, height: h, width: w, tabOrder: z },
    visual: {
      visualType: 'cardVisual',
      query: {
        queryState: {
          Data: {
            projections: [
              {
                field: {
                  Measure: {
                    Expression: { SourceRef: { Entity: entity } },
                    Property: measure,
                  },
                },
                queryRef: `${entity}.${measure}`,
                nativeQueryRef: measure,
              },
            ],
          },
        },
      },
    },
  };
}

function textbox(id, x, y, w, h, z, text) {
  return {
    $schema:
      'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
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
                        fontSize: '11pt',
                        color: '#B45309',
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

// Remove old alert ids if any leftover
for (const id of [
  'tqalertlabel0000001',
  'tqalerttg0000000001',
  'tqalertqh0000000001',
  'tqalerthv0000000001',
]) {
  const d = path.join(TQ, id);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

const M = 24;
const G = 12;
const CW = 1872;

// Keep title + slicers untouched (only re-read, no write unless needed)
// Compress main KPI slightly
write(setPos(read('1d45c967e417921c08c0'), 25, 154, 1870, 120));

// Alert strip
const labelY = 282;
write(textbox('tqalertlabel0000001', 25, labelY, 720, 22, 20, 'Cảnh báo vận hành'));

const cardY = 306;
const cardH = 78;
const n = 3;
const cardW = Math.floor((CW - G * (n - 1)) / n);
write(card('tqalerttg0000000001', 25, cardY, cardW, cardH, 21, 'fact_doanh_thu', 'DT mã trung gian'));
write(card('tqalertqh0000000001', 25 + cardW + G, cardY, cardW, cardH, 22, 'fact_po', 'SL quá hạn'));
write(
  card(
    'tqalerthv0000000001',
    25 + 2 * (cardW + G),
    cardY,
    CW - 2 * (cardW + G),
    cardH,
    23,
    'fact_po',
    'Hàng đang về'
  )
);

// Push mid + line down a bit (only these 3 visuals)
const midY = 396;
const midH = 250;
write(setPos(read('0680a5d2318698338e07'), 25, midY, 1020, midH));
write(setPos(read('5bc2c3dfed501a50102b'), 1055, midY, 840, midH));

const lineY = midY + midH + G;
write(setPos(read('2af42e63010275c51a11'), 24, lineY, 1872, 1080 - lineY - 20));

console.log('OK: Tổng quan only — alerts added. Other pages untouched.');
