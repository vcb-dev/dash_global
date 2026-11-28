---
name: global-vcb-pancake
description: >-
  Dash Global_VCB — React FE + Node BE trên Supabase (schema global): clone/sync từ
  D:\Cursor\Global\pancake\web, login admin/member, CI/CD Docker Hub → Railway, chart
  click filter, sửa layout Overview, chạy local BE :3847, xuất file Sapo (.xlsx/.xls)
  sang CSV UTF-8 BOM để up Supabase. Dùng khi làm Global_VCB, Pancake BI, đồng bộ UI
  Global, deploy BE, pool Postgres, hoặc chuẩn hóa export Sapo.
---

# Global — Pancake BI (Global_VCB)

## Khi nào dùng skill này

- Repo **Global_VCB** (`fe/` Vite React, `be/` Express + `pg`).
- **Nguồn UI/logic tham chiếu:** `D:\Cursor\Global\pancake\web` (vanilla) — khi sync trang mới, query API, chart onClick/legend filter.
- Không nhầm với skill **sapo-supabase-powerbi-bao-cao** (pipeline Sapo → Supabase cũ / Power BI); skill này tập trung **ứng dụng dashboard** và vận hành local/CI.

---

## Cấu trúc & cổng local

| Thành phần | Đường dẫn | Mặc định |
|------------|-----------|----------|
| Frontend | `fe/` | `http://localhost:5173`, `VITE_API_URL` trỏ BE |
| Backend | `be/` | `http://localhost:3847` |
| Env BE | `be/.env` | `SUPABASE_DB_URL`, `DB_SCHEMA=global`, `FE_ORIGIN`, `AUTH_USERS` |
| Login | FE + `/api/login` | `admin:DashGlobal2026`, `member:Member2026` (đổi trong `AUTH_USERS`, format `user:pass\|user2:pass2`) |

Chạy BE: `cd be && node server.js`. FE: `cd fe && npm run dev`.

**Migrate DB (Railway/CI):** workflow deploy BE chạy migrate; local có script migrate trong `be/`.

---

## CI/CD BE (GitHub Actions)

Luồng: push `be/**` → build image → **Docker Hub** → trigger **Railway** redeploy.

Secrets cần (user tự set trên GitHub / Railway — agent không có quyền `gh` admin):

- `DOCKER_USERNAME`, `DOCKER_PASSWORD`
- `RAILWAY_TOKEN`, biến service Railway tương ứng
- `DATABASE_DIRECT` (connection Postgres cho migrate)

Giữ login + bảo vệ API sau deploy; không commit `.env`.

---

## Đồng bộ từ Global (pancake/web)

1. **Query SQL / aggregation:** `be` — file queries (hoặc module queries), route trong `server.js`, cache params theo filter FE.
2. **Trang mới:** port `render*` → React page trong `fe/src/pages/`, dùng `useApi`, `fmt`, `DataTable`, `ChartCanvas`.
3. **Filter toàn app:** `App.jsx` — ngày, kho (seg All/…), mã cũ-mới, SPU search; `api.js` gửi query string.
4. **Chart filter:** `chartFilter` context — click cột/trục/doughnut legend → set filter chip trên topbar.

Trang đã sync (tham khảo): Overview, PhanTichDt, DayTonXau, HanhDong + các trang dash gốc.

---

## FE — Layout Overview (lỗi hay gặp)

**Triệu chứng:** bảng “Chi tiết theo kho” chỉ rộng nửa card; hai card “kho” và “Tổng SPU” dính sát; “Danh sách đang bỏ” bị cắt cột khi xếp ngang.

**Nguyên nhân đã xử lý:**

- `DataTable` prop `compact` + CSS `.table-wrap.compact { width: fit-content }` → bảng không full width — **không dùng compact** cho bảng kho / đang bỏ.
- Margin chỉ áp `.content > .card` trong khi Overview bọc trong wrapper → **không có khoảng cách giữa card**.

**Chuẩn hiện tại:**

- Wrapper trang: `className="page-stack"` — CSS `display: flex; flex-direction: column; gap: 18px`.
- Phần SPU: `spu-panels` **xếp dọc** (`Theo phân khúc` rồi `Danh sách đang bỏ`), mỗi khối `spu-panel`, bảng `width: 100%` trong `.table-wrap`.
- `table.data`: `table-layout: auto`; tránh `nowrap` hàng loạt trên cột dài (Tên).

File chính: `fe/src/pages/Overview.jsx`, `fe/src/index.css`, `fe/src/components/DataTable.jsx`.

---

## BE — Postgres pool & lỗi

**Đã có:** `pool.on('error', …)` log `Postgres pool idle client error` — client idle bị reset không làm crash process.

| Lỗi | Ý nghĩa | Hướng xử lý |
|-----|---------|-------------|
| `read ECONNRESET` | Supabase pooler đóng connection idle | Log + request tiếp theo lấy client mới; restart BE nếu treo |
| `ENOTFOUND aws-0-…pooler.supabase.com` | Mạng/DNS/VPN | Kiểm tra mạng, `SUPABASE_DB_URL` trong `be/.env` |
| `EADDRINUSE :3847` | BE đã chạy | Không start thêm; hoặc kill process giữ port rồi start một instance |

Restart BE (PowerShell): kill process port 3847 nếu cần, `node server.js` trong `be/`. Shell nền Cursor đôi khi báo exit `4294967295` dù BE vẫn sống — kiểm tra bằng `EADDRINUSE` hoặc gọi API.

**Schema:** `DB_SCHEMA` / `global` — helper `fq('table')` trong `be/lib/db.js`.

---

## Xuất Sapo / Shopify → CSV (up Supabase)

**Mục tiêu:** file trong `Downloads` (`.xlsx` hoặc `.xls` Sapo) → `.csv` **UTF-8 BOM** (`utf-8-sig`) cùng thư mục, giữ tên gốc đổi đuôi.

**Python (Windows):** `pandas`, `openpyxl` (xlsx), `xlrd` (xls thật). Nếu thiếu: `pip install pandas openpyxl xlrd`.

**Đọc file:**

- `.xlsx` → `pd.read_excel(path, dtype=str)` (một sheet → một `.csv`; nhiều sheet → `tên__SheetName.csv`).
- `.xls` Sapo thường là Excel binary → `read_excel` + engine `xlrd`; nếu fail thử `pd.read_html` (export HTML giả .xls).

**Ví dụ one-liner (một file, một sheet):**

```python
from pathlib import Path
import pandas as pd
src = Path(r"C:\Users\Admin\Downloads\file.xlsx")
df = pd.read_excel(src, dtype=str)
df.to_csv(src.with_suffix(".csv"), index=False, encoding="utf-8-sig")
```

**Loại file đã làm trong project:**

| Nguồn | Gợi ý bảng / mục đích |
|-------|------------------------|
| `products_export_*.xlsx` | Danh mục sản phẩm |
| `xuat_file_bao_cao_doanh_thu_theo_ma_sku_*.xls` | Doanh thu SKU |
| `xuat_file_bao_cao_ton_kho_*.xls` | Tồn kho |
| `xuat_file_bao_cao_xuat_nhap_ton_*.xls` | Xuất nhập tồn |
| `Danh_Sach_PO_*.xlsx` | PO — chỉ CSV local, không bắt buộc up |

Upload Supabase: Table Editor → Import CSV; map cột, kiểu số/text; thêm `ky_bao_cao` nếu theo quy ước kỳ (xem skill Sapo–Supabase).

---

## Đọc lại MD mỗi lần làm việc

Agent **không nhớ suông** từ chat cũ. Mỗi lần bắt đầu việc:

1. `AGENTS.md` — quy tắc làm việc.
2. `Global.md` (file này) / skill `global-vcb-pancake` — kiến thức dash, sync, BE, layout.
3. `scripts/README.md` — khi đụng script/sync/CSV; **cấm** rải file ra root.
4. Có kiến thức mới → bổ sung vào đúng MD trước khi dừng.

## scripts/ — sync · check · seed · ops · data

**Toàn bộ** script + map CSV/JSON phụ trợ nằm trong **`scripts/`**. Catalog: `scripts/README.md`.

- Sync: `node scripts/sync_dt_ton.js …`, `node scripts/sync_orders_funnel.js …` (env `be/.env`).
- Check/seed/ops: `node scripts/<file>.js`. Seed thử: `node run_draft.js <seed_….js>` → `global_draft`.
- Map SPU: `scripts/spu_mapping.csv`, `scripts/spu_new_map.csv` (+ raw/json).
- Root chỉ còn launcher: `run_draft.js`, `pancake_export.ps1` — **không** tạo `.js`/`.csv` lẻ ở root.
- Đối chiếu KPI / hủy-hoàn / AOV / bounds → dùng script có sẵn trong `scripts/` trước khi viết query mới.

## Checklist agent

**Sync UI từ Global:** diff render + CSS gốc → React component; không phá login/CI.

**Sửa layout Overview:** dùng `page-stack`, không `compact` bảng full-width; SPU xếp dọc.

**BE down:** đọc log terminal → DNS/pool → restart một process :3847.

**Đổi export sang CSV:** `dtype=str` giữ mã SKU/leading zero; `utf-8-sig` cho Excel VN.

**Commit/push:** chỉ khi user yêu cầu; không commit `.env`.

---

## Liên kết trong máy CamSang

- App: `d:\Cursor\Global_VCB`
- UI gốc: `D:\Cursor\Global\pancake\web`
- Skill pipeline Sapo/BI: `sapo-supabase-powerbi-bao-cao` (trong synced skills)