/**
 * Lọc/sắp bảng kiểu header: click mũi tên cột số, tìm SPU ngay trong th SPU.
 */
window.tableUtil = {
  /**
   * @param {HTMLTableElement} table
   * @param {object} opts
   * @param {number[]} [opts.sortCols] index cột sort được (0-based)
   * @param {number[]} [opts.searchCols] index cột text để tìm (thường SPU)
   * @param {number} [opts.searchTh] index th hiện ô tìm (mặc định searchCols[0])
   * @param {string} [opts.searchPlaceholder]
   */
  enhance(table, opts = {}) {
    if (!table || !table.tHead || !table.tBodies[0]) return;
    const headRow = table.tHead.rows[0];
    const body = table.tBodies[0];
    const foot = table.tFoot;
    const sortCols = new Set(opts.sortCols || []);
    const searchCols = opts.searchCols || [];
    const searchTh = opts.searchTh != null ? opts.searchTh : searchCols[0];
    const state = { col: null, dir: 'desc', q: '' };

    // snapshot rows gốc
    const source = [...body.rows].map((tr) => {
      const cells = [...tr.cells].map((td) => ({
        html: td.innerHTML,
        text: td.textContent.trim(),
        num: parseNum(td.textContent),
      }));
      return { html: tr.innerHTML, cells, isTotal: /tổng/i.test(tr.textContent) };
    });
    const dataRows = source.filter((r) => !r.isTotal);
    const totalRows = source.filter((r) => r.isTotal);

    [...headRow.cells].forEach((th, i) => {
      if (sortCols.has(i)) {
        th.classList.add('th-sort');
        if (!th.querySelector('.sort-ind')) {
          const label = th.childNodes.length ? null : th.textContent;
          const text = th.textContent.trim();
          th.innerHTML = `<span class="sort-ind" aria-hidden="true"></span><span class="th-label">${text}</span>`;
        }
        th.addEventListener('click', (e) => {
          if (e.target.closest('input')) return;
          if (state.col === i) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
          else {
            state.col = i;
            state.dir = 'desc';
          }
          paintHeads();
          render();
        });
      }
      if (i === searchTh && searchCols.length) {
        th.classList.add('th-search');
        if (!th.querySelector('.th-search-input')) {
          const label = th.querySelector('.th-label')?.textContent || th.textContent.trim() || 'SPU';
          th.innerHTML = `
            <div class="th-search-wrap">
              <span class="th-label">${label.replace(/\s*🔍.*/, '')}</span>
              <input class="th-search-input" type="search" placeholder="${opts.searchPlaceholder || 'Tìm…'}" />
            </div>`;
        }
        const inp = th.querySelector('.th-search-input');
        inp?.addEventListener('click', (e) => e.stopPropagation());
        inp?.addEventListener('input', () => {
          state.q = inp.value.trim().toUpperCase();
          render();
        });
        inp?.addEventListener('keydown', (e) => e.stopPropagation());
      }
    });

    function paintHeads() {
      [...headRow.cells].forEach((th, i) => {
        th.classList.toggle('sorted', state.col === i);
        th.classList.toggle('asc', state.col === i && state.dir === 'asc');
        th.classList.toggle('desc', state.col === i && state.dir === 'desc');
      });
    }

    function render() {
      let rows = dataRows.slice();
      if (state.q && searchCols.length) {
        rows = rows.filter((r) =>
          searchCols.some((ci) => String(r.cells[ci]?.text || '').toUpperCase().includes(state.q))
        );
      }
      if (state.col != null) {
        const ci = state.col;
        const dir = state.dir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          const na = a.cells[ci]?.num;
          const nb = b.cells[ci]?.num;
          if (na != null && nb != null && !(Number.isNaN(na) || Number.isNaN(nb))) {
            return (na - nb) * dir;
          }
          return String(a.cells[ci]?.text || '').localeCompare(String(b.cells[ci]?.text || ''), 'vi') * dir;
        });
      }
      body.innerHTML = '';
      if (!rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="${headRow.cells.length}" style="text-align:center;padding:14px;color:#5b6b7a">Không có dòng phù hợp</td>`;
        body.appendChild(tr);
      } else {
        rows.forEach((r) => {
          const tr = document.createElement('tr');
          tr.innerHTML = r.html;
          body.appendChild(tr);
        });
      }
      // keep foot totals if any; body totals re-append
      totalRows.forEach((r) => {
        const tr = document.createElement('tr');
        tr.innerHTML = r.html;
        body.appendChild(tr);
      });
    }

    paintHeads();
  },
};

function parseNum(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s || s === '—' || s === '-') return null;
  // vi-VN: 1.234.567 or 1,9 tỷ / 696,8M
  let t = s.replace(/\s/g, '');
  if (/tỷ/i.test(t)) {
    const n = parseFloat(t.replace(/tỷ/i, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n * 1e9 : null;
  }
  if (/M$/i.test(t)) {
    const n = parseFloat(t.replace(/M$/i, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n * 1e6 : null;
  }
  if (/K$/i.test(t)) {
    const n = parseFloat(t.replace(/K$/i, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n * 1e3 : null;
  }
  // plain vi number 295.547.535
  const plain = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(plain);
  return Number.isFinite(n) ? n : null;
}
