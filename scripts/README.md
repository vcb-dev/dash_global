# scripts/ — sync · check · seed · probe · ops · data

Mọi script vận hành / one-off / map CSV-JSON phụ trợ nằm **ở đây**. Không tạo file `.js` / `.ps1` / `.csv` lẻ ở root repo.

**Mỗi lần làm việc liên quan scripts:** đọc lại file này + `AGENTS.md` (không dựa trí nhớ phiên trước). Kiến thức mới → ghi thêm vào catalog dưới.

Env từ `be/.env`. Output CSV nạp DB mặc định: root `output/` (thư mục tạm, có thể tạo lại).

```powershell
node scripts/sync_dt_ton.js 2026-10-01 2026-11-26
node scripts/sync_orders_funnel.js 2026-09-01 2026-11-26
node scripts/load_supabase.js .\output
node scripts/check_aov.js
node run_draft.js seed_snapshot_tu_thang_10.js   # ép DB_SCHEMA=global_draft
.\pancake_export.ps1                             # vẫn gọi từ root; map + load trong scripts/
```

**Được phép ở root:** `fe/`, `be/`, `AGENTS.md`, `Global.md`, `package.json`, `docker-compose.yml`, `run_draft.js` (launcher), `pancake_export.ps1` (entry export POS).

---

## CẤM rải file ra root

| Được | Không được |
|------|------------|
| Script mới → `scripts/` | `check_*.js`, `seed_*.js`, `_probe_*`, `sync_*.js` ở root |
| Map SPU / CSV phụ trợ → `scripts/` | `spu_*.csv`, `spu_*.json` ở root |
| Runtime app → `fe/`, `be/` | One-off debug SQL/JS nằm cạnh `package.json` |
| Ghi catalog 1 dòng vào README này | Tạo script rồi bỏ quên không document |

Agent: trước khi `Write` file `.js`/`.csv` mới ở root → dừng, đặt vào `scripts/`, cập nhật bảng dưới.

---

## Kiến thức nhanh (đối chiếu POS / dash)

| Khái niệm | Nguồn đúng | Ghi chú |
|-----------|------------|---------|
| Doanh thu / Đơn chốt / SL | `global.fact_doanh_thu` / `_moi_nhat` | Ngày theo kỳ filter; Nhật = kho **CÓ VAT** |
| Xuất / Thành công / Hủy / Hoàn | `global.fact_don_hang` | Phễu POS; hoàn = `returned` (không gộp `part_returned`) |
| Tồn | `global.fact_ton_kho*` | Bounds ngày = LEAST(max DT ∩ tồn ∩ xuất ∩ TC) |
| Schema | `DB_SCHEMA` hoặc `global` | Draft: `node run_draft.js <seed…>` → `global_draft` |
| Sync DT+tồn | `scripts/sync_dt_ton.js` | Analytics sale + inventory → fact |
| Sync phễu đơn | `scripts/sync_orders_funnel.js` | Orders → fact_don_hang / _ct |

---

## Sync (kéo POS → DB)

| File | Việc |
|------|------|
| `sync_dt_ton.js` | POS analytics/sale + inventory → `fact_doanh_thu` / `fact_ton_kho` |
| `sync_orders_funnel.js` | POS orders → `fact_don_hang` / `fact_don_hang_ct` (xuất/TC/hủy/hoàn) |

---

## Data map (CSV / JSON)

| File | Việc |
|------|------|
| `spu_mapping.csv` | Map tay `spu_goc` → `spu_key` (ưu tiên trong `pancake_export.ps1`) |
| `spu_new_map.csv` | Cặp mã cũ→mới → `spunew` (`load_supabase.refreshDimSpuNew`) |
| `spu_new_map_raw.csv` | Raw nguồn map (tham chiếu) |
| `spu_new_pairs.json` | Cặp spunew dạng JSON (tham chiếu) |

---

## Seed (ghi DB — cẩn thận)

Chạy thẳng → schema `global` (trừ khi `run_draft.js`). Prefer draft trước khi đụng production.

| File | Việc |
|------|------|
| `seed_snapshot_dau_thang.js` | Snapshot tồn xấu = ngày 1 tháng của ngày tồn chốt |
| `seed_snapshot_tu_thang_10.js` | Cohort Tồn xấu kỳ 10: chốt 30/10, đo đẩy sau ngày chốt |
| `seed_snapshot_hop_thang.js` | Họp/chốt list (`SNAP_DATE`); đo đẩy từ ngày sau chốt |
| `seed_cohort_draft.js` | BanNhap/`global_draft`: đóng băng cohort tồn xấu |

---

## Check (chỉ đọc / so số)

| File | Việc |
|------|------|
| `check_aov.js` | TB/đơn theo kho |
| `check_overview_match.js` / `check_overview_sl.js` | Đối chiếu Overview vs fact |
| `check_max_dates.js` | Max ngày / bounds filter |
| `check_schemas.js` | Liệt kê schema |
| `check_don_chot_cmp.js` | So đơn chốt |
| `check_don_huy_hoan.js` (+ `2`, `3`) | Đếm hủy/hoàn (đối POS) |
| `check_huy_nov.js` | Hủy tháng 11 |
| `check_don_pos.ps1` | API analytics sale POS Thái/Nhật |
| `check_mtd_nov.js` | MTD tháng 11 |
| `check_day_oct1.js` / `check_push_oct.js` | Ngày / đẩy tồn tháng 10 |
| `check_122.js` / `check_127.js` | Case số liệu cụ thể |
| `check_spu_190.js` / `check_b001268.js` | Một SPU / mã |
| `check_blank_chung_loai.js` / `check_blank_detail.js` | Blank chủng loại / chi tiết |
| `check_feedback_data.js` | Data feedback |
| `check_prune.js` | Kiểm trước/sau prune |

---

## Probe (API Pancake / FX / outlier)

Tiền tố `_probe_*`. Một số `.ps1` đọc thêm `D:\Cursor\Global\pancake\.env`.

| File | Việc |
|------|------|
| `_probe_funnel_sync.js` | Warehouse / funnel sync |
| `_probe_order_fields.ps1` | Field đơn POS |
| `_probe_status_history.ps1` | Lịch sử trạng thái |
| `_probe_success_record.ps1` | Thử `success_record` analytics |
| `_probe_fx*.js` / `_probe_usd*.js` | Tỷ giá / USD |
| `_probe_outlier.js` | Đơn outlier trên DB |

---

## Ops / draft / nạp dữ liệu

| File | Việc |
|------|------|
| `load_supabase.js` | Nạp CSV `output/` → Postgres; refresh dim/spunew/prune |
| `refresh_ton_xau.js` | Refresh phân khúc + snapshot tồn xấu (`--force`) |
| `prune_now.js` | Prune dim_spu inactive |
| `import_po.js` | Excel Danh sách PO → CSV → `load_supabase.js` |
| `export_sheet.js` | Xuất ra `output/google_sheet` |
| `clone_schema_draft.js` | Clone → `global_draft` |
| `drop_draft_schema.js` | Xóa schema draft |
| `ensure_snapshot_in_dim_draft.js` | Snapshot trong dim draft |
| `compare_ton_xau_main_vs_draft.js` | So tồn xấu main vs draft |
| `insight_friday.js` | Insight báo cáo thứ Sáu |

---

## Quy ước path trong script

1. Env: `path.join(__dirname, '..', 'be', '.env')` (PS1: `..\be\.env`).
2. `pg`: `path.join(__dirname, '..', 'be', 'node_modules', 'pg')` hoặc `require('pg')` (root `node_modules`).
3. Map CSV cùng folder: `path.join(__dirname, 'spu_new_map.csv')`.
4. Output nạp DB: `path.join(__dirname, '..', 'output')`.
5. Seed/ops ghi `global` → 1 dòng catalog ở README; thử qua `run_draft.js`.
6. Không commit secret.
