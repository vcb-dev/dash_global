# dash-global BE

API Node đọc schema Supabase `global`. Không serve HTML.

```bash
cd be
cp .env.example .env   # điền SUPABASE_DB_URL
npm install
npm start
```

http://localhost:3847 — health JSON. API: `/api/overview`, `/api/san-pham`, `/api/ton-kho`, `/api/hang-dang-ve`, `/api/hanh-dong`, `/api/filters`.
