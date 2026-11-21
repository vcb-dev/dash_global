// Đổi mọi M query Schema="global" → Schema="global_draft" trong bản nháp ONLY.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'Pancake_Supabase_BanNhap.SemanticModel');
let n = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tmdl|json)$/i.test(name)) {
      let t = fs.readFileSync(p, 'utf8');
      const before = t;
      t = t.replace(/Schema="global"/g, 'Schema="global_draft"');
      t = t.replace(/Schema='global'/g, "Schema='global_draft'");
      if (t !== before) {
        fs.writeFileSync(p, t, 'utf8');
        n++;
        console.log('updated', path.relative(root, p));
      }
    }
  }
}
walk(root);
console.log(`files changed: ${n}`);

// Verify main untouched
const main = path.join(__dirname, 'Pancake_Supabase.SemanticModel');
let mainHit = 0;
function walkMain(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkMain(p);
    else if (/\.tmdl$/i.test(name)) {
      const t = fs.readFileSync(p, 'utf8');
      if (t.includes('Schema="global_draft"')) {
        mainHit++;
        console.error('MAIN HAS DRAFT SCHEMA!', p);
      }
    }
  }
}
walkMain(main);
console.log(mainHit === 0 ? 'OK: bản chính vẫn Schema=global' : 'ERROR: bản chính bị đổi');
