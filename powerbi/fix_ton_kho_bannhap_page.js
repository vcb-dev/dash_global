/**
 * Sắp xếp lại page Tồn kho cuối kỳ — BanNhap:
 * - Matrix có Tồn cuối kỳ (SL) + GT
 * - Khối cohort đẩy tồn xấu (KPI + bảng + slicer ngày chốt)
 * - Layout đỡ trống
 */
const fs = require('fs');
const path = require('path');

const PAGE = path.join(
  __dirname,
  'Pancake_Supabase_BanNhap.Report',
  'definition',
  'pages',
  'a71cfc684b8c80c00094'
);
const VIS = path.join(PAGE, 'visuals');
const REL = path.join(
  __dirname,
  'Pancake_Supabase_BanNhap.SemanticModel',
  'definition',
  'relationships.tmdl'
);

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// --- 1) Bỏ relationship day_ton_xau → dim_spu (tránh slicer phan_khuc làm rơi cohort) ---
{
  let tmdl = fs.readFileSync(REL, 'utf8');
  const block =
    /relationship a9c8b7d6-e5f4-3210-a9c8-b7d6e5f43210\r?\n\tfromColumn: day_ton_xau\.spu_key\r?\n\ttoColumn: dim_spu\.spu_key\r?\n\r?\n/;
  if (block.test(tmdl)) {
    tmdl = tmdl.replace(block, '');
    fs.writeFileSync(REL, tmdl, 'utf8');
    console.log('Removed day_ton_xau → dim_spu relationship');
  } else {
    console.log('Relationship already absent or format differs');
  }
}

// --- 2) Title ---
writeJson(path.join(VIS, 'tktitle000000000001', 'visual.json'), {
  $schema:
    'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'tktitle000000000001',
  position: { x: 24, y: 8, z: 0, height: 52, width: 720, tabOrder: 0 },
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
                    value: 'Tồn kho cuối kỳ',
                    textStyle: {
                      fontFamily: 'Segoe UI Semibold',
                      fontSize: '26pt',
                      color: '#1b3a4b',
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
});

// --- 3) Top KPI cards (keep, tighten) ---
{
  const card = readJson(path.join(VIS, '24892e3a395b89d306d0', 'visual.json'));
  card.position = { x: 24, y: 64, z: 1000, height: 110, width: 1872, tabOrder: 1000 };
  writeJson(path.join(VIS, '24892e3a395b89d306d0', 'visual.json'), card);
}

// --- 4) Bar chart: nhỏ hơn, thêm Tồn cuối kỳ (SL) ---
{
  const bar = readJson(path.join(VIS, 'c63a583fbe5ccc4b4e28', 'visual.json'));
  bar.position = { x: 24, y: 188, z: 2000, height: 280, width: 900, tabOrder: 2000 };
  const y = bar.visual.query.queryState.Y.projections;
  if (!y.some((p) => p.queryRef === 'fact_ton_kho.Tồn cuối kỳ (SL)')) {
    y.push({
      field: {
        Measure: {
          Expression: { SourceRef: { Entity: 'fact_ton_kho' } },
          Property: 'Tồn cuối kỳ (SL)',
        },
      },
      queryRef: 'fact_ton_kho.Tồn cuối kỳ (SL)',
      nativeQueryRef: 'Tồn cuối kỳ (SL)',
    });
  }
  if (!bar.visual.visualContainerObjects) bar.visual.visualContainerObjects = {};
  bar.visual.visualContainerObjects.title = [
    {
      properties: {
        show: { expr: { Literal: { Value: 'true' } } },
        text: { expr: { Literal: { Value: "'Tồn theo kho (SL + GT)'" } } },
        fontSize: { expr: { Literal: { Value: '12D' } } },
        bold: { expr: { Literal: { Value: 'true' } } },
      },
    },
  ];
  writeJson(path.join(VIS, 'c63a583fbe5ccc4b4e28', 'visual.json'), bar);
}

// --- 5) Matrix: thêm Tồn cuối kỳ (SL) ---
{
  const mx = readJson(path.join(VIS, '6a480d5157298e0ba005', 'visual.json'));
  mx.position = { x: 940, y: 188, z: 3000, height: 280, width: 956, tabOrder: 3000 };
  const vals = mx.visual.query.queryState.Values.projections;
  if (!vals.some((p) => p.queryRef === 'fact_ton_kho.Tồn cuối kỳ (SL)')) {
    vals.unshift({
      field: {
        Measure: {
          Expression: { SourceRef: { Entity: 'fact_ton_kho' } },
          Property: 'Tồn cuối kỳ (SL)',
        },
      },
      queryRef: 'fact_ton_kho.Tồn cuối kỳ (SL)',
      nativeQueryRef: 'Tồn cuối kỳ (SL)',
      displayName: 'Tồn cuối kỳ (SL)',
    });
  }
  if (!mx.visual.visualContainerObjects) mx.visual.visualContainerObjects = {};
  mx.visual.visualContainerObjects.title = [
    {
      properties: {
        show: { expr: { Literal: { Value: 'true' } } },
        text: {
          expr: {
            Literal: {
              Value: "'Phân khúc × kho — chọn Tồn xấu để xem ~SL tồn xấu'",
            },
          },
        },
        fontSize: { expr: { Literal: { Value: '12D' } } },
        bold: { expr: { Literal: { Value: 'true' } } },
      },
    },
  ];
  writeJson(path.join(VIS, '6a480d5157298e0ba005', 'visual.json'), mx);
}

// --- 6) Section title cohort ---
writeJson(path.join(VIS, 'cohorttitle000000001', 'visual.json'), {
  $schema:
    'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'cohorttitle000000001',
  position: { x: 24, y: 480, z: 3500, height: 36, width: 1200, tabOrder: 3500 },
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
                    value:
                      'Theo dõi đẩy tồn xấu (cohort đã chốt) — bán sau ngày chốt = đẩy, không đổi lịch sử xấu',
                    textStyle: {
                      fontFamily: 'Segoe UI Semibold',
                      fontSize: '14pt',
                      color: '#24364B',
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
});

// --- 7) Snapshot slicer ---
writeJson(path.join(VIS, 'cohortsnap0000000001', 'visual.json'), {
  $schema:
    'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'cohortsnap0000000001',
  position: { x: 24, y: 520, z: 4500, height: 56, width: 280, tabOrder: 4500 },
  visual: {
    visualType: 'slicer',
    query: {
      queryState: {
        Values: {
          projections: [
            {
              field: {
                Column: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'ngay_snapshot',
                },
              },
              queryRef: 'day_ton_xau.ngay_snapshot',
              nativeQueryRef: 'ngay_snapshot',
              active: true,
            },
          ],
        },
      },
      sortDefinition: {
        sort: [
          {
            field: {
              Column: {
                Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                Property: 'ngay_snapshot',
              },
            },
            direction: 'Descending',
          },
        ],
        isDefaultSort: true,
      },
    },
    objects: {
      data: [{ properties: { mode: { expr: { Literal: { Value: "'Dropdown'" } } } } }],
      header: [
        {
          properties: {
            show: { expr: { Literal: { Value: 'true' } } },
            text: { expr: { Literal: { Value: "'Ngày chốt cohort'" } } },
          },
        },
      ],
    },
  },
});

// --- 8) Cohort KPI cards ---
writeJson(path.join(VIS, 'cohortkpi00000000001', 'visual.json'), {
  $schema:
    'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'cohortkpi00000000001',
  position: { x: 320, y: 520, z: 4600, height: 100, width: 1576, tabOrder: 4600 },
  visual: {
    visualType: 'cardVisual',
    query: {
      queryState: {
        Data: {
          projections: [
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'Tồn xấu ban đầu',
                },
              },
              queryRef: 'day_ton_xau.Tồn xấu ban đầu',
              nativeQueryRef: 'Tồn cuối kỳ (SL) lúc chốt',
              displayName: 'Tồn cuối kỳ (SL) lúc chốt',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'SL đẩy cohort',
                },
              },
              queryRef: 'day_ton_xau.SL đẩy cohort',
              nativeQueryRef: 'SL đẩy',
              displayName: 'SL đẩy',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'DT đẩy cohort',
                },
              },
              queryRef: 'day_ton_xau.DT đẩy cohort',
              nativeQueryRef: 'DT đẩy',
              displayName: 'DT đẩy',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'Tồn xấu còn lại',
                },
              },
              queryRef: 'day_ton_xau.Tồn xấu còn lại',
              nativeQueryRef: 'Tồn xấu còn lại',
              displayName: 'Tồn xấu còn lại',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'Số mã cohort',
                },
              },
              queryRef: 'day_ton_xau.Số mã cohort',
              nativeQueryRef: 'Số mã',
              displayName: 'Số mã',
            },
          ],
        },
      },
    },
    objects: {
      label: [
        {
          properties: {
            fontFamily: {
              expr: {
                Literal: {
                  Value: "'''Segoe UI Bold'', wf_segoe-ui_bold, helvetica, arial, sans-serif'",
                },
              },
            },
          },
          selector: { id: 'default' },
        },
      ],
    },
    visualContainerObjects: {
      border: [
        {
          properties: {
            show: { expr: { Literal: { Value: 'true' } } },
            color: { solid: { color: { expr: { Literal: { Value: "'#44546A'" } } } } },
            radius: { expr: { Literal: { Value: '8D' } } },
          },
        },
      ],
    },
  },
  filterConfig: {
    filters: [
      {
        name: 'kpi_snap_default',
        field: {
          Column: {
            Expression: { SourceRef: { Entity: 'day_ton_xau' } },
            Property: 'ngay_snapshot',
          },
        },
        type: 'Categorical',
        filter: {
          Version: 2,
          From: [{ Name: 'd', Entity: 'day_ton_xau', Type: 0 }],
          Where: [
            {
              Condition: {
                In: {
                  Expressions: [
                    {
                      Column: {
                        Expression: { SourceRef: { Source: 'd' } },
                        Property: 'ngay_snapshot',
                      },
                    },
                  ],
                  Values: [[{ Literal: { Value: "datetime'2026-11-19T00:00:00'" } }]],
                },
              },
            },
          ],
        },
      },
    ],
  },
});

// --- 9) Detail table ---
writeJson(path.join(VIS, 'ba5ef9553a2a55bc3030', 'visual.json'), {
  $schema:
    'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
  name: 'ba5ef9553a2a55bc3030',
  position: { x: 24, y: 636, z: 4000, height: 420, width: 1872, tabOrder: 4000 },
  visual: {
    visualType: 'tableEx',
    query: {
      queryState: {
        Values: {
          projections: [
            {
              field: {
                Column: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'spu_key',
                },
              },
              queryRef: 'day_ton_xau.spu_key',
              nativeQueryRef: 'SPU',
              displayName: 'SPU',
            },
            {
              field: {
                Column: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'ten_san_pham',
                },
              },
              queryRef: 'day_ton_xau.ten_san_pham',
              nativeQueryRef: 'Tên sản phẩm',
              displayName: 'Tên sản phẩm',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'Nhãn cohort đóng băng',
                },
              },
              queryRef: 'day_ton_xau.Nhãn cohort đóng băng',
              nativeQueryRef: 'Cohort',
              displayName: 'Cohort',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'Tồn xấu ban đầu',
                },
              },
              queryRef: 'day_ton_xau.Tồn xấu ban đầu',
              nativeQueryRef: 'Tồn cuối kỳ (SL) lúc chốt',
              displayName: 'Tồn cuối kỳ (SL) lúc chốt',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'SL đẩy cohort',
                },
              },
              queryRef: 'day_ton_xau.SL đẩy cohort',
              nativeQueryRef: 'SL đẩy',
              displayName: 'SL đẩy',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'DT đẩy cohort',
                },
              },
              queryRef: 'day_ton_xau.DT đẩy cohort',
              nativeQueryRef: 'DT đẩy',
              displayName: 'DT đẩy',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'Tồn xấu còn lại',
                },
              },
              queryRef: 'day_ton_xau.Tồn xấu còn lại',
              nativeQueryRef: 'Tồn xấu còn lại',
              displayName: 'Tồn xấu còn lại',
            },
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                  Property: 'Trạng thái cohort',
                },
              },
              queryRef: 'day_ton_xau.Trạng thái cohort',
              nativeQueryRef: 'Trạng thái',
              displayName: 'Trạng thái',
            },
          ],
        },
      },
      sortDefinition: {
        sort: [
          {
            field: {
              Measure: {
                Expression: { SourceRef: { Entity: 'day_ton_xau' } },
                Property: 'DT đẩy cohort',
              },
            },
            direction: 'Descending',
          },
        ],
      },
    },
    objects: {
      columnHeaders: [
        {
          properties: {
            fontFamily: {
              expr: {
                Literal: {
                  Value: "'''Segoe UI Bold'', wf_segoe-ui_bold, helvetica, arial, sans-serif'",
                },
              },
            },
            fontColor: {
              solid: { color: { expr: { ThemeDataColor: { ColorId: 0, Percent: 0 } } } },
            },
            backColor: {
              solid: { color: { expr: { Literal: { Value: "'#252E80'" } } } },
            },
          },
        },
      ],
    },
    visualContainerObjects: {
      title: [
        {
          properties: {
            show: { expr: { Literal: { Value: 'true' } } },
            text: {
              expr: {
                Literal: {
                  Value:
                    "'Chi tiết cohort — Tồn cuối kỳ (SL) lúc chốt / SL·DT đẩy / còn lại'",
                },
              },
            },
            fontSize: { expr: { Literal: { Value: '13D' } } },
            bold: { expr: { Literal: { Value: 'true' } } },
            fontColor: { solid: { color: { expr: { Literal: { Value: "'#24364B'" } } } } },
          },
        },
      ],
      border: [
        {
          properties: {
            show: { expr: { Literal: { Value: 'true' } } },
            color: { solid: { color: { expr: { Literal: { Value: "'#44546A'" } } } } },
            radius: { expr: { Literal: { Value: '10D' } } },
          },
        },
      ],
      background: [
        {
          properties: {
            show: { expr: { Literal: { Value: 'true' } } },
            transparency: { expr: { Literal: { Value: '0D' } } },
          },
        },
      ],
    },
  },
  filterConfig: {
    filters: [
      {
        name: 'tbl_snap_default',
        field: {
          Column: {
            Expression: { SourceRef: { Entity: 'day_ton_xau' } },
            Property: 'ngay_snapshot',
          },
        },
        type: 'Categorical',
        filter: {
          Version: 2,
          From: [{ Name: 'd', Entity: 'day_ton_xau', Type: 0 }],
          Where: [
            {
              Condition: {
                In: {
                  Expressions: [
                    {
                      Column: {
                        Expression: { SourceRef: { Source: 'd' } },
                        Property: 'ngay_snapshot',
                      },
                    },
                  ],
                  Values: [[{ Literal: { Value: "datetime'2026-11-19T00:00:00'" } }]],
                },
              },
            },
          ],
        },
      },
      {
        name: 'tbl_spu',
        field: {
          Column: {
            Expression: { SourceRef: { Entity: 'day_ton_xau' } },
            Property: 'spu_key',
          },
        },
        type: 'Categorical',
      },
      {
        name: 'tbl_ten',
        field: {
          Column: {
            Expression: { SourceRef: { Entity: 'day_ton_xau' } },
            Property: 'ten_san_pham',
          },
        },
        type: 'Categorical',
      },
    ],
  },
});

// Reposition existing page slicers neatly on top-right
{
  const dateSl = readJson(path.join(VIS, '3c782c0612366335b2b4', 'visual.json'));
  dateSl.position = { x: 760, y: 8, z: 5000, height: 48, width: 360, tabOrder: 5000 };
  writeJson(path.join(VIS, '3c782c0612366335b2b4', 'visual.json'), dateSl);

  const khoSl = readJson(path.join(VIS, 'dc82c7ac72e351944018', 'visual.json'));
  khoSl.position = { x: 1140, y: 8, z: 6000, height: 48, width: 200, tabOrder: 6000 };
  writeJson(path.join(VIS, 'dc82c7ac72e351944018', 'visual.json'), khoSl);

  const pkSl = readJson(path.join(VIS, '813b8917bc11c11a347c', 'visual.json'));
  pkSl.position = { x: 1360, y: 8, z: 7000, height: 48, width: 240, tabOrder: 7000 };
  writeJson(path.join(VIS, '813b8917bc11c11a347c', 'visual.json'), pkSl);
}

console.log('BanNhap page Tồn kho cuối kỳ layout updated.');
