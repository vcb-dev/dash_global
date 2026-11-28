// Chạy script bất kỳ với DB_SCHEMA=global_draft (không đụng global).
// Ví dụ: node run_draft.js seed_snapshot_tu_thang_10.js
//         node run_draft.js refresh_ton_xau.js --force
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Dùng: node run_draft.js <script.js> [args...]');
  process.exit(1);
}
const script = args[0];
const rest = args.slice(1);
const node = path.join(__dirname, 'tools', 'node', 'node.exe');
const exe = fs.existsSync(node) ? node : 'node';

const atRoot = path.resolve(__dirname, script);
const inScripts = path.resolve(__dirname, 'scripts', path.basename(script));
const target = fs.existsSync(atRoot) ? atRoot : inScripts;
if (!fs.existsSync(target)) {
  console.error(`Không tìm thấy script: ${script}`);
  process.exit(1);
}

const env = { ...process.env, DB_SCHEMA: 'global_draft' };
console.log(`[draft] DB_SCHEMA=global_draft → ${path.relative(__dirname, target)} ${rest.join(' ')}`);
const r = spawnSync(exe, [target, ...rest], {
  cwd: __dirname,
  env,
  stdio: 'inherit',
  shell: false,
});
process.exit(r.status || 0);
