import { ErcotDataError, isDate } from './ercot-data.js';

export const MONTHLY_METRICS = Object.freeze({
  average_demand_mw: Object.freeze({ label: 'Average demand', unit: 'MW' }),
  peak_demand_mw: Object.freeze({ label: 'Peak demand', unit: 'MW' }),
  energy_mwh: Object.freeze({ label: 'Observed total energy', unit: 'MWh' })
});
export function monthlyMetric(key) {
  if (!Object.hasOwn(MONTHLY_METRICS, key)) throw new ErcotDataError('filter', 'Choose a supported monthly metric.');
  return MONTHLY_METRICS[key];
}
export function dailyBounds(report) {
  if (!report.rows.length) return null;
  return { start: report.rows[0].date, end: report.rows.at(-1).date };
}
function nextDate(value, monthly = false) {
  const date = new Date(`${value}T00:00:00Z`);
  if (monthly) date.setUTCMonth(date.getUTCMonth() + 1); else date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export function calendarRows(rows, start, end, monthly = false) {
  const byDate = new Map(rows.map(row => [row.date, row]));
  const result = [];
  for (let day = start; day <= end; day = nextDate(day, monthly)) {
    if (result.length >= 36600) throw new ErcotDataError('filter', 'This date range is too large to display. Choose a shorter range.');
    result.push(byDate.get(day) || { date: day, missing: true, observed: null, expected: null });
  }
  return result;
}
export function filterDaily(report, start, end) {
  const bounds = dailyBounds(report);
  if (!bounds) return [];
  if (!isDate(start) || !isDate(end) || start > end || start < bounds.start || end > bounds.end) throw new ErcotDataError('filter', `Choose dates from ${bounds.start} through ${bounds.end}, with the start on or before the end.`);
  return calendarRows(report.rows, start, end);
}
export function monthlyRows(report) {
  const start = `${report.metadata.reporting_range.start.slice(0, 7)}-01`;
  const endDate = new Date(`${report.metadata.reporting_range.end_exclusive}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return calendarRows(report.rows, start, `${endDate.toISOString().slice(0, 7)}-01`, true);
}
export function isPartialMonth(row, report) {
  if (report.kind !== 'monthly') return false;
  const range = report.metadata.reporting_range;
  return range.start > row.date || range.end_exclusive < nextDate(row.date, true);
}
export function periodStatus(row, report) {
  if (row.missing || row.observed === 0) return 'No observations; unavailable';
  const notes = [];
  if (row.observed !== row.expected) notes.push('Incomplete observation counts');
  if (isPartialMonth(row, report)) notes.push('Partial calendar month: reporting-range bounds');

  // Counts cannot detect unexpected observations replacing missing keys.
  if (report.metadata.quality !== 'complete') notes.push('See dataset coverage audit');
  return notes.length ? notes.join('; ') : 'Complete';
}
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export function formatValue(value, unit = '') {
  return value === null || value === undefined ? 'Unavailable' : `${number.format(value)}${unit ? ` ${unit}` : ''}`;
}
export function chartConfig(kind, report, rows, metric = 'average_demand_mw', includeMinimum = false) {
  const monthly = kind === 'monthly';
  const specification = monthly ? monthlyMetric(metric) : { label: 'Demand', unit: 'MW' };
  const make = (field, label, color, dash = []) => ({
    label, data: rows.map(row => row[field] ?? null), borderColor: color, backgroundColor: color,
    borderWidth: 2, borderDash: dash, spanGaps: false,
    pointRadius: rows.map(row => !row.missing && row.observed !== row.expected ? 4 : rows.length < 40 ? 2 : 0),
    pointStyle: rows.map(row => row.observed !== row.expected ? 'triangle' : 'circle'), pointHoverRadius: 5
  });
  const datasets = monthly ? [make(metric, specification.label, '#1261a6')] : [make('average_demand_mw', 'Average demand', '#1261a6', [6, 3]), make('peak_demand_mw', 'Peak demand', '#0a2540')];
  if (!monthly && includeMinimum) datasets.push(make('minimum_demand_mw', 'Minimum demand', '#527a5e', [2, 3]));
  return {
    type: monthly ? 'bar' : 'line', data: { labels: rows.map(row => row.date), datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { title: { display: true, text: monthly ? 'Reporting month' : 'Reporting date' }, grid: { display: false }, ticks: { maxTicksLimit: 4, autoSkipPadding: 12, maxRotation: 0, callback: (_value, index) => monthly ? rows[index].date.slice(0, 7) : rows[index].date.slice(5) } },
        y: { beginAtZero: true, title: { display: true, text: `${specification.label} (${specification.unit})` }, ticks: { maxTicksLimit: 6, callback: value => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value) }, grid: { color: '#eaf0f5' } }
      },
      plugins: {
        legend: { display: !monthly, onClick: () => {}, labels: { color: '#4d6173', boxWidth: 22, font: { family: 'Arial, sans-serif' } } },
        tooltip: { callbacks: {
          title: items => items[0] ? rows[items[0].dataIndex].date : '',
          label: item => `${item.dataset.label}: ${formatValue(item.parsed.y, specification.unit)}`,
          footer: items => {
            const row = rows[items[0]?.dataIndex];
            return !row ? '' : `${row.observed ?? 'Unavailable'} / ${row.expected ?? 'Unavailable'} observed / expected records\n${periodStatus(row, report)}`;
          }
        } }
      }
    }
  };
}



