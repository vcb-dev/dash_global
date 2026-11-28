import { createContext, useContext } from 'react';

/** applyChartFilter(patch) — click chart/legend → lọc toàn dashboard (toggle). */
export const ChartFilterContext = createContext(() => {});

export function useChartFilter() {
  return useContext(ChartFilterContext);
}

export function toFullKho(label) {
  const s = String(label || '').trim();
  if (!s || s === 'All') return 'All';
  if (s.startsWith('KHO ')) return s;
  return `KHO ${s}`;
}
