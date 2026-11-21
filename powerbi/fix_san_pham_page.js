/**
 * Trang Sản phẩm: mix chỉ còn phân khúc bán hàng thật.
 * Mã trung gian + Dịch vụ → tách ra card cảnh báo (không nằm trong treemap/bảng mix).
 */
const fs = require('fs');
const path = require('path');

const RP = path.join(__dirname, 'Pancake_Supabase.Report', 'definition', 'pages');
const SP = '0da433e99042dd26e0ed';
const TMDL = path.join(__dirname, 'Pancake_Supabase.SemanticModel', 'definition', 'tables', 'fact_doanh_thu.tmdl');

function excludePhanKhucFilter(name) {
  return {
    name,
    field: {
      Column: {
        Expression: { SourceRef: { Entity: 'dim_spu' } },
        Property: 'phan_khuc',
      },
    },
    type: 'Categorical',
    filter: {
      Version: 2,
      From: [{ Name: 'd', Entity: 'dim_spu', Type: 0 }],
      Where: [
        {
          Condition: {
            Not: {
              Expression: {
                In: {
                  Expressions: [
                    {
                      Column: {
                        Expression: { SourceRef: { Source: 'd' } },
                        Property: 'phan_khuc',
                      },
                    },
                  ],
                  Values: [
                    [{ Literal: { Value: "'Mã trung gian'" } }],
                    [{ Literal: { Value: "'Dịch vụ/Đặt hàng'" } }],
                  ],
                },
              },
            },
          },
        },
      ],
    },
    howCreated: 'User',
  };
}

function onlyTrungGianFilter(name) {
  return {
    name,
    field: {
      Column: {
        Expression: { SourceRef: { Entity: 'dim_spu' } },
        Property: 'phan_khuc',
      },
    },
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
              Values: [[{ Literal: { Value: "'Mã trung gian'" } }]],
            },
          },
        },
      ],
    },
    howCreated: 'User',
  };
}

function patchExclude(visualId) {
  const p = path.join(RP, SP, 'visuals', visualId, 'visual.json');
  const v = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!v.filterConfig) v.filterConfig = { filters: [] };
  // drop old empty/categorical phan_khuc without exclude
  v.filterConfig.filters = (v.filterConfig.filters || []).filter(
    (f) => !(f.field && f.field.Column && f.field.Column.Property === 'phan_khuc')
  );
  v.filterConfig.filters.push(excludePhanKhucFilter(`ex_${visualId}`));
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
  console.log('Excluded Mã trung gian from', visualId);
}

// Mix visuals
patchExclude('89be2bd83ce74560060c'); // treemap
patchExclude('edddc563490c3a43c418'); // table
patchExclude('72f80b800630b1c0a89d'); // bar chủng loại

// Warning card: only Mã trung gian DT
const cardPath = path.join(RP, SP, 'visuals', '1b332c4762b586e50366', 'visual.json');
const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
card.filterConfig = {
  filters: [
    {
      name: 'warn_dt',
      field: {
        Measure: {
          Expression: { SourceRef: { Entity: 'fact_doanh_thu' } },
          Property: 'Doanh thu',
        },
      },
      type: 'Advanced',
    },
    onlyTrungGianFilter('warn_pk'),
  ],
};
// Show phan_khuc as row label instead of raw MATRUNGGIANBAC only — keep spu_key for detail
card.visual.query.queryState.Rows = {
  projections: [
    {
      field: {
        Column: {
          Expression: { SourceRef: { Entity: 'dim_spu' } },
          Property: 'spu_key',
        },
      },
      queryRef: 'dim_spu.spu_key',
      nativeQueryRef: 'spu_key',
    },
  ],
};
fs.writeFileSync(cardPath, JSON.stringify(card, null, 2) + '\n', 'utf8');
console.log('Warning card = only Mã trung gian');

// Title tweak + warning label
const title = {
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'sptitle000000000001',
  position: { x: 24, y: 12, z: 0, height: 36, width: 900, tabOrder: 0 },
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
                    value: 'Sản phẩm và phân khúc',
                    textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '22pt', color: '#1B3A4B' },
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
fs.writeFileSync(path.join(RP, SP, 'visuals', 'sptitle000000000001', 'visual.json'), JSON.stringify(title, null, 2) + '\n');

const warnLabel = {
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'spwarnlabel00000001',
  position: { x: 968, y: 520, z: 5, height: 28, width: 928, tabOrder: 5 },
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
                    value: '⚠ Cảnh báo — DT ghi trên mã trung gian (chưa map SKU thật)',
                    textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '12pt', color: '#B45309' },
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
fs.mkdirSync(path.join(RP, SP, 'visuals', 'spwarnlabel00000001'), { recursive: true });
fs.writeFileSync(path.join(RP, SP, 'visuals', 'spwarnlabel00000001', 'visual.json'), JSON.stringify(warnLabel, null, 2) + '\n');

// Shrink card a bit under label
card.position.y = 548;
card.position.height = 508;
fs.writeFileSync(cardPath, JSON.stringify(card, null, 2) + '\n', 'utf8');

// Measure helper
let tmdl = fs.readFileSync(TMDL, 'utf8');
if (!tmdl.includes("measure 'DT mã trung gian'")) {
  tmdl = tmdl.replace(
    "measure 'Tỷ trọng doanh thu'",
    "measure 'DT mã trung gian' = CALCULATE([Doanh thu], dim_spu[phan_khuc] = \"Mã trung gian\")\n\t\tformatString: #,0\n\t\tlineageTag: e9f1a2b3-4c5d-6e7f-8091-a2b3c4d5e6f7\n\n\tmeasure 'Tỷ trọng doanh thu'"
  );
  fs.writeFileSync(TMDL, tmdl, 'utf8');
  console.log('Added measure DT mã trung gian');
}

console.log('Done');
