const chartStore = {};

const COLORS = {
  navy: '#252e80',
  teal: '#0f766e',
  red: '#dc2626',
  blue: '#1d4ed8',
  orange: '#ea580c',
  slate: '#64748b',
  soft: 'rgba(37,46,128,0.10)',
  growth: '#c2410c',
};

function moneyShort(v) {
  return window.fmt.money(v);
}

function moneyTip(v) {
  return window.fmt.moneyFull(v);
}

function basePlugins(extra = {}) {
  return {
    legend: { display: false },
    datalabels: {
      color: '#1b3a4b',
      font: { weight: '600', size: 11, family: "'Be Vietnam Pro', sans-serif" },
      formatter: (v) => moneyShort(v),
      clamp: true,
      clip: false,
      ...extra.datalabels,
    },
    tooltip: {
      backgroundColor: '#1e293b',
      titleFont: { size: 12, weight: '600' },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 8,
      ...extra.tooltip,
    },
    ...extra,
  };
}

/** Center donut: nhãn "Tổng" phía trên, value to phía dưới. */
function donutCenterPlugin(text, sub) {
  return {
    id: 'donutCenter',
    afterDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data.length) return;
      const { x, y } = meta.data[0];
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (sub) {
        ctx.fillStyle = '#5b6b7a';
        ctx.font = "600 11px 'Be Vietnam Pro', sans-serif";
        ctx.fillText(sub, x, y - 14);
      }
      ctx.fillStyle = '#1b3a4b';
      ctx.font = "800 22px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(text, x, y + (sub ? 8 : 0));
      ctx.restore();
    },
  };
}

window.charts = {
  destroy(id) {
    if (chartStore[id]) {
      chartStore[id].destroy();
      delete chartStore[id];
    }
  },

  bar(id, labels, values, opts = {}) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const horizontal = !!opts.horizontal;
    const thick = opts.thick !== false;
    chartStore[id] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: opts.color || COLORS.navy,
            borderRadius: 10,
            maxBarThickness: opts.maxBarThickness || (horizontal ? (thick ? 52 : 28) : 56),
            categoryPercentage: thick ? 0.72 : 0.6,
            barPercentage: thick ? 0.9 : 0.75,
          },
        ],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22, right: horizontal ? 56 : 8, left: horizontal ? 8 : 4, bottom: 4 } },
        plugins: basePlugins({
          datalabels: {
            anchor: 'end',
            align: horizontal ? 'end' : 'top',
            offset: 4,
            formatter: (v) => (opts.format === 'num' ? window.fmt.num(v) : moneyShort(v)),
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const i = items[0]?.dataIndex ?? 0;
                return labels[i] ?? '';
              },
              label: (c) =>
                opts.format === 'num' ? window.fmt.num(c.raw) : moneyTip(c.raw),
            },
          },
        }),
        scales: {
          x: {
            grid: { display: !horizontal, color: '#edf1f5', drawBorder: false },
            ticks: {
              color: '#5b6b7a',
              font: { size: 11 },
              maxRotation: 0,
              ...(horizontal ? { callback: (v) => moneyShort(v) } : {}),
            },
            border: { display: false },
          },
          y: {
            grid: { color: horizontal ? 'transparent' : '#edf1f5', drawBorder: false },
            ticks: {
              color: '#5b6b7a',
              font: { size: 12, weight: horizontal ? '600' : '400' },
              autoSkip: false,
              ...(horizontal
                ? {
                    callback(_v, i) {
                      return labels[i] ?? '';
                    },
                  }
                : { callback: (v) => moneyShort(v) }),
            },
            border: { display: false },
          },
        },
      },
      plugins: [ChartDataLabels],
    });
  },

  /** Cột DT + đường tỷ trọng % — 1 nhãn gọn "DT · %", không chồng chữ */
  barLineShare(id, labels, values, sharePcts) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const shares = (sharePcts || []).map((v) =>
      v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)
    );
    const nums = shares.filter((v) => v != null);
    const gMax = nums.length ? Math.max(...nums) : 50;
    chartStore[id] = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Doanh thu',
            data: values,
            backgroundColor: COLORS.teal,
            borderRadius: 10,
            maxBarThickness: 56,
            categoryPercentage: 0.7,
            barPercentage: 0.88,
            yAxisID: 'y',
            order: 2,
            datalabels: {
              anchor: 'end',
              align: 'top',
              offset: 4,
              color: '#1b3a4b',
              font: { weight: '700', size: 10 },
              textAlign: 'center',
              formatter: (v, ctx) => {
                const pct = shares[ctx.dataIndex];
                const money = moneyShort(v);
                if (pct == null) return money;
                return `${money}\n${Number(pct).toFixed(1)}%`;
              },
            },
          },
          {
            type: 'line',
            label: 'Tỷ trọng %',
            data: shares,
            borderColor: COLORS.growth,
            backgroundColor: COLORS.growth,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#fff',
            pointBorderColor: COLORS.growth,
            pointBorderWidth: 2,
            tension: 0.25,
            yAxisID: 'yPct',
            order: 1,
            spanGaps: false,
            datalabels: { display: false },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 36, right: 8, left: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (c) => {
                if (c.dataset.yAxisID === 'yPct') {
                  const v = c.raw;
                  if (v == null) return 'Tỷ trọng: —';
                  return `Tỷ trọng: ${Number(v).toFixed(1)}%`;
                }
                return `Doanh thu: ${moneyTip(c.raw)}`;
              },
            },
          },
          datalabels: {},
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#5b6b7a', font: { size: 11, weight: '600' }, maxRotation: 0 },
            border: { display: false },
          },
          y: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            grace: '8%',
            grid: { color: '#edf1f5' },
            ticks: { color: '#5b6b7a', font: { size: 10 }, callback: (v) => moneyShort(v) },
            border: { display: false },
          },
          yPct: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: Math.min(100, Math.ceil((gMax + 8) / 5) * 5),
            grid: { drawOnChartArea: false },
            ticks: {
              color: COLORS.growth,
              font: { size: 10 },
              callback: (v) => `${Number(v).toFixed(0)}%`,
            },
            border: { display: false },
          },
        },
      },
      plugins: [ChartDataLabels],
    });
  },

  doughnut(id, labels, values, colors, opts = {}) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const sum = values.reduce((a, b) => a + Number(b || 0), 0);
    const sumSafe = sum || 1;
    const centerMain =
      opts.center ||
      (opts.format === 'num' ? window.fmt.num(sum) : moneyShort(sum));
    const centerSub = opts.centerSub || 'Tổng';
    chartStore[id] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors || [COLORS.navy, COLORS.teal, COLORS.orange, COLORS.slate],
            borderWidth: 0,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        layout: { padding: { top: 4, right: 4, bottom: 4, left: 4 } },
        plugins: basePlugins({
          legend: {
            display: true,
            position: 'right',
            align: 'center',
            labels: {
              boxWidth: 8,
              boxHeight: 8,
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 10,
              font: { size: 10 },
              generateLabels: (chart) => {
                const ds = chart.data.datasets[0];
                return chart.data.labels.map((label, i) => {
                  // namesOnly: chỉ màu + tên (vd Mã cũ / Mã mới)
                  const text = opts.legendNamesOnly
                    ? String(label)
                    : `${label}  ${
                        opts.format === 'num' ? window.fmt.num(ds.data[i]) : moneyShort(ds.data[i])
                      } · ${((ds.data[i] / sumSafe) * 100).toFixed(1)}%`;
                  return {
                    text,
                    fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i],
                    hidden: false,
                    index: i,
                  };
                });
              },
            },
          },
          datalabels: {
            color: '#fff',
            font: { weight: '700', size: 10 },
            formatter: (v) => {
              const pct = (v / sumSafe) * 100;
              if (pct < 8) return '';
              const main =
                opts.format === 'num' ? window.fmt.num(v) : moneyShort(v);
              return `${main}\n${pct.toFixed(0)}%`;
            },
            textAlign: 'center',
          },
          tooltip: {
            callbacks: {
              label: (c) => {
                const pct = ((c.raw / sumSafe) * 100).toFixed(1);
                const val =
                  opts.format === 'num' ? window.fmt.num(c.raw) : moneyTip(c.raw);
                return `${c.label}: ${val} (${pct}%)`;
              },
            },
          },
        }),
      },
      plugins: [ChartDataLabels, donutCenterPlugin(centerMain, centerSub)],
    });
  },

  /** Doanh thu theo ngày: không legend; benchmark chỉ hiện khi hover */
  line(id, labels, values, benchmark) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const datasets = [
      {
        label: 'Doanh thu',
        data: values,
        borderColor: COLORS.teal,
        backgroundColor: COLORS.soft,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: COLORS.teal,
        borderWidth: 2.5,
        datalabels: {
          display: true,
          align: 'top',
          anchor: 'end',
          offset: 2,
          color: '#0f766e',
          font: { weight: '700', size: 10 },
          formatter: (v) => moneyShort(v),
        },
      },
    ];
    if (benchmark != null) {
      datasets.push({
        label: 'Benchmark DT/ngày',
        data: labels.map(() => benchmark),
        borderColor: COLORS.red,
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        datalabels: { display: false },
      });
    }
    chartStore[id] = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 22, right: 8, left: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: (items) => {
                const i = items[0]?.dataIndex ?? 0;
                return labels[i] || '';
              },
              label: (c) => `${c.dataset.label}: ${moneyTip(c.raw)}`,
            },
          },
          datalabels: {},
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#5b6b7a', font: { size: 10 }, maxRotation: 0 },
            border: { display: false },
          },
          y: {
            grid: { color: '#edf1f5' },
            ticks: {
              color: '#5b6b7a',
              font: { size: 10 },
              callback: (v) => moneyShort(v),
            },
            border: { display: false },
          },
        },
      },
      plugins: [ChartDataLabels],
    });
  },
};
