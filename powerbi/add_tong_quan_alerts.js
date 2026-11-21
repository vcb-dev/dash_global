/**
 * Tổng quan: thêm hàng KPI cảnh báo (DT mã trung gian, SL quá hạn, Hàng đang về).
 * Không gộp page khác; không đụng Page 1.
 */
const fs = require('fs');
const path = require('path');

const RP = path.join(__dirname, 'Pancake_Supabase.Report', 'definition', 'pages');
const TQ = '67a13695837b0e0c0e20';
const M = 24;
const G = 16;
const CW = 1872;

function writeVisual(v) {
  const dir = path.join(RP, TQ, 'visuals', v.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'visual.json'), JSON.stringify(v, null, 2) + '\n', 'utf8');
}

function readVisual(id) {
  return JSON.parse(fs.readFileSync(path.join(RP, TQ, 'visuals', id, 'visual.json'), 'utf8'));
}

function setPos(v, x, y, w, h, z) {
  v.position = { x, y, z: z ?? v.position.z, height: h, width: w, tabOrder: z ?? v.position.tabOrder };
  return v;
}

function card(id, x, y, w, h, z, entity, measure) {
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
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
                        fontSize: fontSize || '12pt',
                        color: color || '#B45309',
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

// Re-layout: keep slicers; shrink main KPIs; insert alert row; push charts down
const mainKpi = readVisual('1d45c967e417921c08c0');
writeVisual(setPos(mainKpi, M, 154, CW, 118, 10));

const alertY = 280;
const alertLabelH = 24;
writeVisual(
  textbox(
    'tqalertlabel0000001',
    M,
    alertY,
    700,
    alertLabelH,
    20,
    'Cảnh báo vận hành (không gộp trang khác)',
    '11pt',
    '#B45309'
  )
);

const cardY = alertY + alertLabelH + 4;
const cardH = 88;
const n = 3;
const cardW = Math.floor((CW - G * (n - 1)) / n);
const alerts = [
  ['tqalerttg0000000001', 'fact_doanh_thu', 'DT mã trung gian'],
  ['tqalertqh0000000001', 'fact_po', 'SL quá hạn'],
  ['tqalerthv0000000001', 'fact_po', 'Hàng đang về'],
];
alerts.forEach(([id, entity, measure], i) => {
  const w = i === n - 1 ? CW - i * (cardW + G) : cardW;
  writeVisual(card(id, M + i * (cardW + G), cardY, w, cardH, 21 + i, entity, measure));
});

const midY = cardY + cardH + G; // ~388
const midH = 250;
const leftW = Math.floor((CW - G) * 0.55);
const rightW = CW - G - leftW;

writeVisual(setPos(readVisual('0680a5d2318698338e07'), M, midY, leftW, midH, 11));
writeVisual(setPos(readVisual('5bc2c3dfed501a50102b'), M + leftW + G, midY, rightW, midH, 12));

const lineY = midY + midH + G;
writeVisual(setPos(readVisual('2af42e63010275c51a11'), M, lineY, CW, 1080 - lineY - M, 13));

console.log('Tổng quan alerts added. midY=', midY, 'lineY=', lineY);
