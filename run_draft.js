// Chạy script bất kỳ với DB_SCHEMA=global_draft (không đụng global).
// Ví dụ: node run_draft.js seed_snapshot_tu_thang_10.js
//         node run_draft.js refresh_ton_xau.js --force
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Dùng: node run_draft.js <script.js> [args...]');
  process.exit(1);
}
const script = args[0];
const rest = args.slice(1);
const node = path.join(__dirname, 'tools', 'node', 'node.exe');
const exe = require('fs').existsSync(node) ? node : 'node';

const env = { ...process.env, DB_SCHEMA: 'global_draft' };
console.log(`[draft] DB_SCHEMA=global_draft → ${script} ${rest.join(' ')}`);
const r = spawnSync(exe, [path.resolve(__dirname, script), ...rest], {
  cwd: __dirname,
  env,
  stdio: 'inherit',
  shell: false,
});
process.exit(r.status || 0);
