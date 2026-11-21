# dash-global FE

Dashboard tĩnh (HTML/CSS/JS). Gọi API ở folder `be`.

```bash
cd fe
npm start
```

Mở http://localhost:5173 — BE phải chạy sẵn ở http://localhost:3847.

Đổi URL API: sửa `js/config.js` (`window.API_BASE`). Deploy Vercel: Root Directory = `fe`, rồi trỏ `API_BASE` sang URL backend.
