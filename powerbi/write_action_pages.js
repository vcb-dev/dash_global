// Sinh trang Hành động + bổ sung ETA/Flag vào Hàng đang về.
// Không đụng Page 1. Chạy khi Power BI Desktop đã đóng.
const fs = require('fs');
const path = require('path');

const RP = path.join(__dirname, 'Pancake_Supabase.Report', 'definition', 'pages');
const PAGE1 = '09692c2376539228b785';
const TONG_QUAN = '67a13695837b0e0c0e20';
const SAN_PHAM = '0da433e99042dd26e0ed';
const TON_KHO = 'a71cfc684b8c80c00094';
const HANG_VE = '476aadefade1493ca46e';
const HANH_DONG = '25326ef9de0be821a0ea';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function textbox(id, x, y, w, h, z, text, fontSize = '16pt') {
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
                        fontFamily: 'Segoe (Bold)',
                        fontSize,
                        color: '#03396c',
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

function slicerKho(id, x, y, w, h, z) {
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
                    Expression: { SourceRef: { Entity: 'dim_kho' } },
                    Property: 'kho',
                  },
                },
                queryRef: 'dim_kho.kho',
                nativeQueryRef: 'kho',
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
    field: {
      Column: {
        Expression: { SourceRef: { Entity: entity } },
        Property: prop,
      },
    },
    queryRef: `${entity}.${prop}`,
    nativeQueryRef: prop,
  };
}

function meas(entity, prop) {
  return {
    field: {
      Measure: {
        Expression: { SourceRef: { Entity: entity } },
        Property: prop,
      },
    },
    queryRef: `${entity}.${prop}`,
    nativeQueryRef: prop,
  };
}

function categoricalFilter(name, entity, prop, values) {
  return {
    name,
    field: {
      Column: {
        Expression: { SourceRef: { Entity: entity } },
        Property: prop,
      },
    },
    type: 'Categorical',
    filter: {
      Version: 2,
      From: [{ Name: 'd', Entity: entity, Type: 0 }],
      Where: [
        {
          Condition: {
            In: {
              Expressions: [
                {
                  Column: {
                    Expression: { SourceRef: { Source: 'd' } },
                    Property: prop,
                  },
                },
              ],
              Values: values.map((v) => [{ Literal: { Value: `'${v}'` } }]),
            },
          },
        },
      ],
    },
    howCreated: 'User',
  };
}

function tableEx(id, x, y, w, h, z, projections, filters) {
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
    name: id,
    position: { x, y, z, height: h, width: w, tabOrder: z },
    visual: {
      visualType: 'tableEx',
      query: {
        queryState: {
          Values: { projections },
        },
      },
    },
    filterConfig: { filters },
  };
}

function actionFilters(prefix, phanKhuc) {
  return [
    categoricalFilter(prefix + 'pk', 'dim_spu', 'phan_khuc', [phanKhuc]),
    {
      name: prefix + 'gt',
      field: {
        Measure: {
          Expression: { SourceRef: { Entity: 'fact_ton_kho' } },
          Property: 'Giá trị tồn cuối kỳ',
        },
      },
      type: 'Advanced',
    },
    {
      name: prefix + 'dt',
      field: {
        Measure: {
          Expression: { SourceRef: { Entity: 'fact_doanh_thu' } },
          Property: 'Doanh thu',
        },
      },
      type: 'Advanced',
    },
    {
      name: prefix + 'po',
      field: {
        Measure: {
          Expression: { SourceRef: { Entity: 'fact_po' } },
          Property: 'Hàng đang về',
        },
      },
      type: 'Advanced',
    },
  ];
}

const actionCols = [
  col('dim_spu', 'spu_key'),
  col('dim_spu', 'ten_san_pham'),
  col('dim_spu', 'phan_khuc'),
  col('dim_kho', 'kho'),
  meas('fact_ton_kho', 'Tồn cuối kỳ (SL)'),
  meas('fact_ton_kho', 'Giá trị tồn cuối kỳ'),
  meas('fact_doanh_thu', 'Doanh thu'),
  meas('fact_doanh_thu', 'Số lượng bán'),
  meas('fact_po', 'Hàng đang về'),
  meas('fact_po', 'Gợi ý'),
];

// --- Hành động ---
const hdDir = path.join(RP, HANH_DONG);
const hdVisualsRoot = path.join(hdDir, 'visuals');
if (fs.existsSync(hdVisualsRoot)) {
  for (const name of fs.readdirSync(hdVisualsRoot)) {
    fs.rmSync(path.join(hdVisualsRoot, name), { recursive: true, force: true });
  }
}
ensureDir(hdVisualsRoot);
writeJson(path.join(hdDir, 'page.json'), {
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json',
  name: HANH_DONG,
  displayName: 'Hành động',
  displayOption: 'FitToPage',
  height: 1080,
  width: 1920,
});

const hdVisuals = [
  textbox('hdtitle000000000001', 20, 12, 1400, 48, 0, 'Hành động tuần này', '24pt'),
  slicerKho('hdslicer00000000001', 1600, 12, 280, 90, 1),
  textbox('hdlab10000000000001', 20, 100, 900, 32, 2, '1. Ưu tiên về hàng / giữ stock (Bán chạy)', '14pt'),
  tableEx('hdtable100000000001', 20, 136, 1880, 280, 3, actionCols, actionFilters('hd1', 'Bán chạy')),
  textbox('hdlab20000000000001', 20, 430, 700, 32, 4, '2. Xả tồn / cắt đặt (Tồn xấu)', '14pt'),
  tableEx('hdtable200000000001', 20, 466, 1880, 260, 5, actionCols, actionFilters('hd2', 'Tồn xấu')),
  textbox('hdlab30000000000001', 20, 740, 700, 32, 6, '3. Theo dõi (Bán chậm)', '14pt'),
  tableEx('hdtable300000000001', 20, 776, 1880, 280, 7, actionCols, actionFilters('hd3', 'Bán chậm')),
];

for (const v of hdVisuals) {
  writeJson(path.join(hdDir, 'visuals', v.name, 'visual.json'), v);
}

// --- Bổ sung ETA + Flag vào bảng Hàng đang về (giữ visual hiện có, chỉ mở rộng cột) ---
const hvTablePath = path.join(RP, HANG_VE, 'visuals', '9846dd000da3bc0d77e6', 'visual.json');
if (fs.existsSync(hvTablePath)) {
  const hv = JSON.parse(fs.readFileSync(hvTablePath, 'utf8'));
  const props = hv.visual.query.queryState.Values.projections;
  const has = (entity, prop) =>
    props.some(
      (p) =>
        (p.field.Column && p.field.Column.Expression.SourceRef.Entity === entity && p.field.Column.Property === prop) ||
        (p.queryRef === `${entity}.${prop}`)
    );
  if (!has('fact_po', 'han_giao')) props.push(col('fact_po', 'han_giao'));
  if (!has('fact_po', 'Flag ETA')) props.push(col('fact_po', 'Flag ETA'));
  if (!has('fact_po', 'ma_po')) props.unshift(col('fact_po', 'ma_po'));
  writeJson(hvTablePath, hv);
  console.log('Patched Hàng đang về table with ETA + Flag');
} else {
  console.log('WARN: Hàng đang về table not found, skip patch');
}

writeJson(path.join(RP, 'pages.json'), {
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json',
  pageOrder: [PAGE1, TONG_QUAN, SAN_PHAM, TON_KHO, HANG_VE, HANH_DONG],
  activePageName: HANH_DONG,
});

console.log('OK Hành động visuals:', hdVisuals.length);
console.log('Page order preserved; Page 1 untouched');
