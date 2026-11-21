/**
 * Dựng lại trang Hàng đang về: KPI ETA trực quan + donut Flag + bar SPU + bảng gọn.
 * Đồng thời sửa bảng Tồn kho (bỏ cột raw 0, dùng measure + tên SP).
 * Chạy khi Power BI Desktop đã đóng.
 */
const fs = require('fs');
const path = require('path');

const RP = path.join(__dirname, 'Pancake_Supabase.Report', 'definition', 'pages');
const HV = '476aadefade1493ca46e';
const TK = 'a71cfc684b8c80c00094';
const M = 24;
const G = 16;
const W = 1920;
const H = 1080;
const CW = W - M * 2;

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function writeVisual(pageId, v) {
  writeJson(path.join(RP, pageId, 'visuals', v.name, 'visual.json'), v);
}

function textbox(id, x, y, w, h, z, text, fontSize = '20pt', color = '#1B3A4B') {
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
                      textStyle: { fontFamily: 'Segoe UI Semibold', fontSize, color },
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

function slicer(id, x, y, w, h, z, entity, prop) {
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
    name: id,
    position: { x, y, z, height: h, width: w, tabOrder: z },
    visual: {
      visualType: 'slicer',
      query: {
        queryState: {
          Values: {
            projections: [
              {
                field: {
                  Column: {
                    Expression: { SourceRef: { Entity: entity } },
                    Property: prop,
                  },
                },
                queryRef: `${entity}.${prop}`,
                nativeQueryRef: prop,
                active: true,
              },
            ],
          },
        },
      },
    },
  };
}

function col(entity, prop) {
  return {
    field: { Column: { Expression: { SourceRef: { Entity: entity } }, Property: prop } },
    queryRef: `${entity}.${prop}`,
    nativeQueryRef: prop,
  };
}

function meas(entity, prop) {
  return {
    field: { Measure: { Expression: { SourceRef: { Entity: entity } }, Property: prop } },
    queryRef: `${entity}.${prop}`,
    nativeQueryRef: prop,
  };
}

// ---- wipe Hàng đang về visuals ----
const hvDir = path.join(RP, HV, 'visuals');
if (fs.existsSync(hvDir)) {
  for (const n of fs.readdirSync(hvDir)) fs.rmSync(path.join(hvDir, n), { recursive: true, force: true });
}

writeJson(path.join(RP, HV, 'page.json'), {
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json',
  name: HV,
  displayName: 'Hàng đang về',
  displayOption: 'FitToPage',
  height: H,
  width: W,
});

const visuals = [];

visuals.push(textbox('hvtitle000000000001', M, 12, 900, 36, 0, 'Hàng đang về — theo dõi ETA', '22pt'));
visuals.push(
  textbox(
    'hvlegend00000000001',
    M,
    48,
    1200,
    28,
    1,
    'Đỏ = Quá hạn  ·  Cam = Sắp đến hạn (≤7 ngày)  ·  Xanh = Còn hạn',
    '12pt',
    '#475569'
  )
);
visuals.push(slicer('hvslicerflag0000001', 1280, 12, 280, 72, 2, 'fact_po', 'Flag ETA'));
visuals.push(slicer('hvslicerpk000000001', 1580, 12, 316, 72, 3, 'dim_spu', 'phan_khuc'));

// 4 KPI: Số PO | Hàng đang về | Quá hạn | Sắp đến hạn
const cardY = 92;
const cardH = 110;
const nCards = 4;
const cardW = Math.floor((CW - G * (nCards - 1)) / nCards);
const kpi = [
  ['hvcardpo00000000001', 'Số PO'],
  ['hvcardsl00000000001', 'Hàng đang về'],
  ['hvcardqh00000000001', 'SL quá hạn'],
  ['hvcardsd00000000001', 'SL sắp đến hạn'],
];
kpi.forEach(([id, m], i) => {
  visuals.push(card(id, M + i * (cardW + G), cardY, i === nCards - 1 ? CW - i * (cardW + G) : cardW, cardH, 4 + i, 'fact_po', m));
});

const midY = cardY + cardH + G;
const midH = 320;
const leftW = Math.floor((CW - G) * 0.42);
const rightW = CW - G - leftW;

// Donut: Flag ETA × Hàng đang về
visuals.push({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'hvdonut000000000001',
  position: { x: M, y: midY, z: 10, height: midH, width: leftW, tabOrder: 10 },
  visual: {
    visualType: 'donutChart',
    query: {
      queryState: {
        Category: {
          projections: [
            {
              field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'Flag ETA' } },
              queryRef: 'fact_po.Flag ETA',
              nativeQueryRef: 'Flag ETA',
              active: true,
            },
          ],
        },
        Y: {
          projections: [meas('fact_po', 'Hàng đang về')],
        },
      },
    },
  },
});

// Bar top SPU
visuals.push({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'hvbar00000000000001',
  position: { x: M + leftW + G, y: midY, z: 11, height: midH, width: rightW, tabOrder: 11 },
  visual: {
    visualType: 'clusteredBarChart',
    query: {
      queryState: {
        Category: {
          projections: [
            {
              field: { Column: { Expression: { SourceRef: { Entity: 'dim_spu' } }, Property: 'spu_key' } },
              queryRef: 'dim_spu.spu_key',
              nativeQueryRef: 'spu_key',
              active: true,
            },
          ],
        },
        Y: { projections: [meas('fact_po', 'Hàng đang về')] },
      },
      sortDefinition: {
        sort: [{ field: meas('fact_po', 'Hàng đang về').field, direction: 'Descending' }],
        isDefaultSort: true,
      },
    },
  },
});

const botY = midY + midH + G;
const botH = H - botY - M;

// Clean table — Flag first, ETA prominent
visuals.push({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'hvtable000000000001',
  position: { x: M, y: botY, z: 12, height: botH, width: CW, tabOrder: 12 },
  visual: {
    visualType: 'tableEx',
    query: {
      queryState: {
        Values: {
          projections: [
            col('fact_po', 'Flag ETA'),
            col('fact_po', 'han_giao'),
            col('fact_po', 'ma_po'),
            col('fact_po', 'spu_key'),
            col('dim_spu', 'phan_khuc'),
            col('fact_po', 'sku'),
            meas('fact_po', 'Hàng đang về'),
            col('fact_po', 'nha_cung_cap'),
          ],
        },
      },
      sortDefinition: {
        sort: [
          {
            field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'han_giao' } },
            direction: 'Ascending',
          },
        ],
        isDefaultSort: true,
      },
    },
    filterConfig: {
      filters: [
        {
          name: 'hvflagf',
          field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'Flag ETA' } },
          type: 'Categorical',
        },
      ],
    },
  },
});

for (const v of visuals) writeVisual(HV, v);
console.log('Hàng đang về rebuilt:', visuals.length, 'visuals');

// ---- Fix Tồn kho detail table ----
const tkTablePath = path.join(RP, TK, 'visuals', 'ba5ef9553a2a55bc3030', 'visual.json');
if (fs.existsSync(tkTablePath)) {
  const tk = JSON.parse(fs.readFileSync(tkTablePath, 'utf8'));
  tk.visual.query.queryState.Values.projections = [
    col('dim_spu', 'spu_key'),
    col('dim_spu', 'ten_san_pham'),
    col('dim_spu', 'phan_khuc'),
    col('dim_spu', 'chung_loai'),
    col('dim_kho', 'kho'),
    meas('fact_ton_kho', 'Tồn cuối kỳ (SL)'),
    meas('fact_ton_kho', 'Giá trị tồn cuối kỳ'),
  ];
  // Keep existing phan_khuc = Tồn xấu filter; add advanced filter placeholder for GT tồn
  const filters = (tk.filterConfig && tk.filterConfig.filters) || [];
  const hasPk = filters.some((f) => f.field && f.field.Column && f.field.Column.Property === 'phan_khuc');
  if (!hasPk) {
    filters.push({
      name: 'tkpk',
      field: { Column: { Expression: { SourceRef: { Entity: 'dim_spu' } }, Property: 'phan_khuc' } },
      type: 'Categorical',
      filter: {
        Version: 2,
        From: [{ Name: 'd', Entity: 'dim_spu', Type: 0 }],
        Where: [
          {
            Condition: {
              In: {
                Expressions: [
                  {
                    Column: {
                      Expression: { SourceRef: { Source: 'd' } },
                      Property: 'phan_khuc',
                    },
                  },
                ],
                Values: [[{ Literal: { Value: "'Tồn xấu'" } }]],
              },
            },
          },
        ],
      },
      howCreated: 'User',
    });
  }
  filters.push({
    name: 'tkgt',
    field: {
      Measure: {
        Expression: { SourceRef: { Entity: 'fact_ton_kho' } },
        Property: 'Giá trị tồn cuối kỳ',
      },
    },
    type: 'Advanced',
  });
  tk.filterConfig = { filters };
  writeJson(tkTablePath, tk);
  console.log('Tồn kho detail table cleaned');
}

console.log('Done. Reopen PBIP and Refresh calculated column Flag ETA once.');
