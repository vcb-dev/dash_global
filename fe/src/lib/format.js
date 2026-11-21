export const fmt = {
  num(n, dig = 0) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: dig, minimumFractionDigits: dig });
  },
  money(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    if (Math.abs(v) >= 1e9) {
      return `${(v / 1e9).toLocaleString('vi-VN', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      })} tỷ`;
    }
    if (Math.abs(v) >= 1e6) {
      return `${(v / 1e6).toLocaleString('vi-VN', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}M`;
    }
    if (Math.abs(v) >= 1e3) {
      return `${(v / 1e3).toLocaleString('vi-VN', {
        maximumFractionDigits: 0,
      })}K`;
    }
    return v.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
  },
  moneyFull(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
  },
  pct(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return `${(Number(n) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
  },
};
