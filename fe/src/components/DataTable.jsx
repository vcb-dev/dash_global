import { useMemo, useState } from 'react';

export default function DataTable({ columns, rows, searchPlaceholder = 'Tìm…', footer }) {
  const [sort, setSort] = useState({ key: null, dir: 'desc' });
  const [q, setQ] = useState('');
  const searchCols = columns.filter((c) => c.search);

  const visible = useMemo(() => {
    let list = rows || [];
    const query = q.trim().toUpperCase();
    if (query && searchCols.length) {
      list = list.filter((row) =>
        searchCols.some((c) => String(c.searchValue ? c.searchValue(row) : row[c.key] || '').toUpperCase().includes(query))
      );
    }
    if (sort.key) {
      const col = columns.find((c) => c.key === sort.key);
      const dir = sort.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const va = col?.sortValue ? col.sortValue(a) : a[sort.key];
        const vb = col?.sortValue ? col.sortValue(b) : b[sort.key];
        const na = Number(va);
        const nb = Number(vb);
        if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
        return String(va ?? '').localeCompare(String(vb ?? ''), 'vi') * dir;
      });
    }
    return list;
  }, [rows, q, sort, columns, searchCols]);

  function toggleSort(col) {
    if (!col.sort) return;
    setSort((s) =>
      s.key === col.key ? { key: col.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: col.key, dir: 'desc' }
    );
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((col) => {
              const sorted = sort.key === col.key;
              const className = [col.className, col.sort ? 'th-sort' : '', sorted ? `sorted ${sort.dir}` : '']
                .filter(Boolean)
                .join(' ');
              return (
                <th key={col.key} className={className} onClick={() => toggleSort(col)}>
                  {col.search ? (
                    <div className="th-search-wrap">
                      <span className="th-label">
                        {col.sort ? <span className="sort-ind" aria-hidden="true" /> : null}
                        {col.label}
                      </span>
                      <input
                        className="th-search-input"
                        type="search"
                        placeholder={searchPlaceholder}
                        value={q}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setQ(e.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      {col.sort ? <span className="sort-ind" aria-hidden="true" /> : null}
                      <span className="th-label">{col.label}</span>
                    </>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {!visible.length ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', padding: 14, color: '#5b6b7a' }}>
                Không có dòng phù hợp
              </td>
            </tr>
          ) : (
            visible.map((row, i) => (
              <tr key={row._key || i}>
                {columns.map((col) => (
                  <td key={col.key} className={col.className || ''}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer ? (
          <tfoot>
            <tr className="row-total">
              {footer.map((cell, i) => (
                <td key={i} className={cell.className || ''} colSpan={cell.colSpan || undefined}>
                  {cell.content}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
