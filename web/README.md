# Pancake BI Web

Dashboard web (Node) đọc cùng schema Supabase `global` như file Power BI chính.  
Mở thẳng dashboard — không cần đăng nhập.

## Chạy nhanh

```bash
cd d:\IDE\pancake\web
node server.js
```

Mở http://localhost:3847

Server tự đọc `d:\IDE\pancake\.env` (SUPABASE_DB_URL).

## Trang tương ứng BI

| Web | Power BI |
|---|---|
| Tổng quan điều hành | Tổng quan |
| Sản phẩm & phân khúc | Sản phẩm |
| Tồn kho cuối kỳ | Tồn kho + chi tiết tồn xấu |
| Hàng đang về — ETA | PO / Flag ETA |
| Hành động tuần này | Bán chạy / Tồn xấu / Bán chậm |
