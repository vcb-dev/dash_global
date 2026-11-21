/**
 * Căn lại layout trang 2–6 (không đụng Page 1).
 * Canvas 1920×1080, margin 24, gap 16.
 * Chạy khi Power BI Desktop đã đóng.
 */
const fs = require('fs');
const path = require('path');

const RP = path.join(__dirname, 'Pancake_Supabase.Report', 'definition', 'pages');
const W = 1920;
const H = 1080;
const M = 24;
const G = 16;
const CONTENT_W = W - M * 2; // 1872

function readVisual(pageId, visualId) {
  const p = path.join(RP, pageId, 'visuals', visualId, 'visual.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeVisual(pageId, visualId, obj) {
  const dir = path.join(RP, pageId, 'visuals', visualId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'visual.json'), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function setPos(v, x, y, w, h, z) {
  v.position = {
    x,
    y,
    z: z ?? v.position.z ?? 0,
    height: h,
    width: w,
    tabOrder: z ?? v.position.tabOrder ?? 0,
  };
  return v;
}

function textbox(id, x, y, w, h, z, text, fontSize = '20pt') {
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
                        fontSize,
                        color: '#1B3A4B',
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

function equalRow(count, y, h, startZ) {
  const totalGap = G * (count - 1);
  const w = Math.floor((CONTENT_W - totalGap) / count);
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push({ x: M + i * (w + G), y, w, h, z: startZ + i });
  }
  // last slot absorbs remainder
  const used = slots[count - 1].x + slots[count - 1].w;
  slots[count - 1].w += M + CONTENT_W - used;
  return slots;
}

// ========== TỔNG QUAN ==========
const TQ = '67a13695837b0e0c0e20';
{
  const title = textbox('tqtitle000000000001', M, 16, 900, 44, 0, 'Tổng quan điều hành', '22pt');
  writeVisual(TQ, title.name, title);

  // Existing slicers — redistribute evenly under title
  const slicerIds = [
    '1a57b6450003162e5698', // kho
    '193c0e98c2b06ee886d2', // phan_khuc
    'a0474fff6e34b2555204', // chung_loai
    '544037d5e9a5333c3999', // ma_cu_moi
    'e0f5f5a08cec23db79cd', // ngay
  ];
  const sSlots = equalRow(5, 68, 86, 1);
  slicerIds.forEach((id, i) => {
    const v = readVisual(TQ, id);
    writeVisual(TQ, id, setPos(v, sSlots[i].x, sSlots[i].y, sSlots[i].w, sSlots[i].h, sSlots[i].z));
  });

  // KPI cards
  let v = readVisual(TQ, '1d45c967e417921c08c0');
  writeVisual(TQ, '1d45c967e417921c08c0', setPos(v, M, 170, CONTENT_W, 150, 10));

  // Mid row: bar kho | donut — side by side, no overlap
  const midH = 280;
  const midY = 336;
  const leftW = Math.floor((CONTENT_W - G) * 0.55);
  const rightW = CONTENT_W - G - leftW;
  v = readVisual(TQ, '0680a5d2318698338e07');
  writeVisual(TQ, '0680a5d2318698338e07', setPos(v, M, midY, leftW, midH, 11));
  v = readVisual(TQ, '5bc2c3dfed501a50102b');
  writeVisual(TQ, '5bc2c3dfed501a50102b', setPos(v, M + leftW + G, midY, rightW, midH, 12));

  // Bottom: trend full width
  v = readVisual(TQ, '2af42e63010275c51a11');
  writeVisual(TQ, '2af42e63010275c51a11', setPos(v, M, midY + midH + G, CONTENT_W, H - (midY + midH + G) - M, 13));
  console.log('OK Tổng quan');
}

// ========== SẢN PHẨM ==========
const SP = '0da433e99042dd26e0ed';
{
  writeVisual(SP, 'sptitle000000000001', textbox('sptitle000000000001', M, 16, 900, 44, 0, 'Sản phẩm và phân khúc', '22pt'));

  const topY = 72;
  const topH = 460;
  const half = Math.floor((CONTENT_W - G) / 2);

  let v = readVisual(SP, '89be2bd83ce74560060c'); // treemap
  writeVisual(SP, '89be2bd83ce74560060c', setPos(v, M, topY, half, topH, 1));
  v = readVisual(SP, 'edddc563490c3a43c418'); // table
  writeVisual(SP, 'edddc563490c3a43c418', setPos(v, M + half + G, topY, CONTENT_W - half - G, topH, 2));

  const botY = topY + topH + G;
  const botH = H - botY - M;
  v = readVisual(SP, '72f80b800630b1c0a89d'); // bar chung_loai
  writeVisual(SP, '72f80b800630b1c0a89d', setPos(v, M, botY, half, botH, 3));
  v = readVisual(SP, '1b332c4762b586e50366'); // cards top SPU
  writeVisual(SP, '1b332c4762b586e50366', setPos(v, M + half + G, botY, CONTENT_W - half - G, botH, 4));
  console.log('OK Sản phẩm');
}

// ========== TỒN KHO ==========
const TK = 'a71cfc684b8c80c00094';
{
  writeVisual(TK, 'tktitle000000000001', textbox('tktitle000000000001', M, 16, 900, 44, 0, 'Tồn kho cuối kỳ', '22pt'));

  // KPI full width top
  let v = readVisual(TK, '24892e3a395b89d306d0');
  writeVisual(TK, '24892e3a395b89d306d0', setPos(v, M, 72, CONTENT_W, 130, 1));

  const midY = 218;
  const midH = 360;
  const half = Math.floor((CONTENT_W - G) / 2);
  v = readVisual(TK, 'c63a583fbe5ccc4b4e28'); // bar by kho
  writeVisual(TK, 'c63a583fbe5ccc4b4e28', setPos(v, M, midY, half, midH, 2));
  v = readVisual(TK, '6a480d5157298e0ba005'); // pivot phan_khuc x kho
  writeVisual(TK, '6a480d5157298e0ba005', setPos(v, M + half + G, midY, CONTENT_W - half - G, midH, 3));

  // Detail table full bottom (Tồn xấu filter already on it)
  const botY = midY + midH + G;
  v = readVisual(TK, 'ba5ef9553a2a55bc3030');
  writeVisual(TK, 'ba5ef9553a2a55bc3030', setPos(v, M, botY, CONTENT_W, H - botY - M, 4));
  console.log('OK Tồn kho');
}

// ========== HÀNG ĐANG VỀ ==========
const HV = '476aadefade1493ca46e';
{
  // Clear old visuals and rebuild clean layout (keep data bindings where possible)
  const hvDir = path.join(RP, HV, 'visuals');
  if (fs.existsSync(hvDir)) {
    for (const name of fs.readdirSync(hvDir)) {
      fs.rmSync(path.join(hvDir, name), { recursive: true, force: true });
    }
  }

  writeVisual(HV, 'hvtitle000000000001', textbox('hvtitle000000000001', M, 16, 1100, 40, 0, 'Hàng đang về — PO Global', '22pt'));
  writeVisual(
    HV,
    'hvlegend00000000001',
    textbox(
      'hvlegend00000000001',
      M,
      56,
      1400,
      32,
      1,
      'ETA = hạn giao · Flag: Quá hạn | Sắp đến hạn (≤7 ngày) | Còn hạn',
      '12pt'
    )
  );
  writeVisual(HV, 'hvslicer00000000001', slicer('hvslicer00000000001', 1560, 16, 336, 72, 2, 'dim_spu', 'phan_khuc'));

  const cardY = 100;
  const cardH = 120;
  const cSlots = equalRow(3, cardY, cardH, 3);
  writeVisual(HV, 'hvcard0000000000001', card('hvcard0000000000001', cSlots[0].x, cSlots[0].y, cSlots[0].w, cSlots[0].h, 3, 'fact_po', 'Số PO'));
  writeVisual(HV, 'hvcard0000000000002', card('hvcard0000000000002', cSlots[1].x, cSlots[1].y, cSlots[1].w, cSlots[1].h, 4, 'fact_po', 'Hàng đang về'));
  writeVisual(HV, 'hvcard0000000000003', card('hvcard0000000000003', cSlots[2].x, cSlots[2].y, cSlots[2].w, cSlots[2].h, 5, 'fact_po', 'Số dòng PO'));

  const midY = cardY + cardH + G;
  const tableW = Math.floor((CONTENT_W - G) * 0.62);
  const barW = CONTENT_W - G - tableW;
  const midH = H - midY - M;

  // Table
  const table = {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
    name: 'hvtable000000000001',
    position: { x: M, y: midY, z: 6, height: midH, width: tableW, tabOrder: 6 },
    visual: {
      visualType: 'tableEx',
      query: {
        queryState: {
          Values: {
            projections: [
              { field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'ma_po' } }, queryRef: 'fact_po.ma_po', nativeQueryRef: 'ma_po' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'spu_key' } }, queryRef: 'fact_po.spu_key', nativeQueryRef: 'spu_key' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'dim_spu' } }, Property: 'phan_khuc' } }, queryRef: 'dim_spu.phan_khuc', nativeQueryRef: 'phan_khuc' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'sku' } }, queryRef: 'fact_po.sku', nativeQueryRef: 'sku' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'so_luong_con_thieu' } }, queryRef: 'fact_po.so_luong_con_thieu', nativeQueryRef: 'so_luong_con_thieu' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'han_giao' } }, queryRef: 'fact_po.han_giao', nativeQueryRef: 'han_giao' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'Flag ETA' } }, queryRef: 'fact_po.Flag ETA', nativeQueryRef: 'Flag ETA' },
              { field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'nha_cung_cap' } }, queryRef: 'fact_po.nha_cung_cap', nativeQueryRef: 'nha_cung_cap' },
            ],
          },
        },
      },
    },
    filterConfig: {
      filters: [
        {
          name: 'hvflag',
          field: { Column: { Expression: { SourceRef: { Entity: 'fact_po' } }, Property: 'Flag ETA' } },
          type: 'Categorical',
        },
      ],
    },
  };
  writeVisual(HV, table.name, table);

  // Bar top thiếu
  const bar = {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.14.0/schema.json',
    name: 'hvbar00000000000001',
    position: { x: M + tableW + G, y: midY, z: 7, height: midH, width: barW, tabOrder: 7 },
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
          Y: {
            projections: [
              {
                field: {
                  Measure: {
                    Expression: { SourceRef: { Entity: 'fact_po' } },
                    Property: 'Hàng đang về',
                  },
                },
                queryRef: 'fact_po.Hàng đang về',
                nativeQueryRef: 'Hàng đang về',
              },
            ],
          },
        },
        sortDefinition: {
          sort: [
            {
              field: {
                Measure: {
                  Expression: { SourceRef: { Entity: 'fact_po' } },
                  Property: 'Hàng đang về',
                },
              },
              direction: 'Descending',
            },
          ],
          isDefaultSort: true,
        },
      },
    },
  };
  writeVisual(HV, bar.name, bar);
  console.log('OK Hàng đang về');
}

// ========== HÀNH ĐỘNG ==========
const HD = '25326ef9de0be821a0ea';
{
  // Even vertical rhythm: title, slicer, 3 equal panels
  writeVisual(HD, 'hdtitle000000000001', textbox('hdtitle000000000001', M, 16, 1200, 40, 0, 'Hành động tuần này', '22pt'));
  writeVisual(HD, 'hdslicer00000000001', slicer('hdslicer00000000001', 1560, 16, 336, 72, 1, 'dim_kho', 'kho'));

  const labelH = 28;
  const startY = 100;
  const avail = H - startY - M;
  const panelGap = G;
  // 3 panels: label + table
  const panelH = Math.floor((avail - panelGap * 2) / 3);
  const labels = [
    ['hdlab10000000000001', '1. Ưu tiên về hàng / giữ stock (Bán chạy)'],
    ['hdlab20000000000001', '2. Xả tồn / cắt đặt (Tồn xấu)'],
    ['hdlab30000000000001', '3. Theo dõi (Bán chậm)'],
  ];
  const tables = ['hdtable100000000001', 'hdtable200000000001', 'hdtable300000000001'];

  labels.forEach(([id, text], i) => {
    const y = startY + i * (panelH + panelGap);
    writeVisual(HD, id, textbox(id, M, y, 1200, labelH, 2 + i * 2, text, '13pt'));
    const tv = readVisual(HD, tables[i]);
    writeVisual(HD, tables[i], setPos(tv, M, y + labelH + 4, CONTENT_W, panelH - labelH - 4, 3 + i * 2));
  });
  console.log('OK Hành động');
}

console.log('Layout polish done. Reopen Pancake_Supabase.pbip');
