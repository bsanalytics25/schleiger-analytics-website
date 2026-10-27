import { ErcotDataError, isDate } from './ercot-data.js';
import { monthlyMetric, monthlyRows, calendarRows, periodStatus, chartConfig, formatValue } from './ercot-chart-model.js';

export const ZONE_NAMES = Object.freeze({ COAST: 'Coast', EAST: 'East', FWEST: 'Far West', NCENT: 'North Central', NORTH: 'North', SCENT: 'South Central', SOUTH: 'South', WEST: 'West' });
export function zoneLabel(zone) { return `${ZONE_NAMES[zone]} (${zone})`; }
export function zoneMonthPeriods(report) { return monthlyRows({ ...report, rows: [] }).map(row => row.date); }
export function monthlyZoneView(report, period, metric) {
  const specification = monthlyMetric(metric);
  if (!zoneMonthPeriods(report).includes(period)) throw new ErcotDataError('filter', 'Choose a month within the published reporting range.');
  const byZone = new Map(report.rows.filter(row => row.date === period).map(row => [row.zoneCode, row]));
  return { period, metric, specification, rows: report.zoneCodes.map(zoneCode => byZone.get(zoneCode) || { zoneCode, date: period, missing: true, observed: null, expected: null }) };
}
function selectedZones(report, zones) {
  if (!Array.isArray(zones) || zones.length < 1 || zones.length > 2 || new Set(zones).size !== zones.length || zones.some(zone => !report.zoneCodes.includes(zone))) throw new ErcotDataError('filter', 'Choose one or two different weather zones from this dataset.');
}
export function zoneDailyBounds(report, zones) {
  selectedZones(report, zones);
  const dates = report.rows.filter(row => zones.includes(row.zoneCode) && row.observed > 0).map(row => row.date).sort();
  return dates.length ? { start: dates[0], end: dates.at(-1) } : null;
}
export function dailyZoneView(report, zones, start, end) {
  const bounds = zoneDailyBounds(report, zones);
  if (!bounds) return { dates: [], series: zones.map(zoneCode => ({ zoneCode, rows: [] })) };
  if (!isDate(start) || !isDate(end) || start > end || start < bounds.start || end > bounds.end) throw new ErcotDataError('filter', `Choose dates from ${bounds.start} through ${bounds.end}, with the start on or before the end.`);
  const series = zones.map(zoneCode => ({ zoneCode, rows: calendarRows(report.rows.filter(row => row.zoneCode === zoneCode), start, end).map(row => ({ ...row, zoneCode })) }));
  return { dates: series[0].rows.map(row => row.date), series };
}
export function zonePeakRows(summary) {
  return summary.metadata.selected_zones.filter(zone => zone !== 'ERCOT').map(zoneCode => summary.zonePeaks.find(row => row.zoneCode === zoneCode) || { zoneCode, demandMW: null, reportingDate: null, hourEndingLocal: null, occurrence: null });
}
export function sortZonePeaks(rows, key = 'demand', direction = 'descending') {
  if (!['zone', 'demand', 'timing'].includes(key) || !['ascending', 'descending'].includes(direction)) throw new ErcotDataError('filter', 'Choose a supported peak sort order.');
  const value = row => key === 'zone' ? row.zoneCode : key === 'demand' ? row.demandMW : row.hourEndingLocal;
  return [...rows].sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const order = av === bv ? (key === 'timing' ? (a.occurrence ?? 0) - (b.occurrence ?? 0) : 0) : key === 'demand' ? av - bv : String(av).localeCompare(String(bv));
    return (direction === 'ascending' ? order : -order) || a.zoneCode.localeCompare(b.zoneCode);
  });
}
export function peakTiming(row, timezone = 'America/Chicago') {
  return row.hourEndingLocal === null ? 'Unavailable — no observations' : `Reporting date ${row.reportingDate}; hour ending ${row.hourEndingLocal.replace('T', ' ')} ${timezone}; occurrence ${row.occurrence}`;
}
export function reportingPeriod(metadata) {
  const end = new Date(`${metadata.reporting_range.end_exclusive}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${metadata.reporting_range.start} through ${end.toISOString().slice(0, 10)}`;
}
function horizontalConfig(rows, values, label, unit) {
  return {
    type: 'bar', data: { labels: rows.map(row => row.zoneCode), datasets: [{ label, data: values, backgroundColor: '#1261a6', borderColor: '#0a2540', borderWidth: 1 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
      scales: { x: { beginAtZero: true, title: { display: true, text: `${label} (${unit})` }, ticks: { maxTicksLimit: 5, callback: value => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value) } }, y: { title: { display: true, text: 'Weather zone' }, ticks: { autoSkip: false }, grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: {} } }
    }
  };
}
export function monthlyZoneConfig(report, view) {
  const { rows, specification: spec, metric, period } = view;
  const config = horizontalConfig(rows, rows.map(row => row[metric] ?? null), spec.label, spec.unit);
  config.options.plugins.tooltip.callbacks = {
    title: items => items[0] ? `${period.slice(0, 7)} · ${zoneLabel(rows[items[0].dataIndex].zoneCode)}` : '',
    label: item => `${spec.label}: ${formatValue(item.parsed.x, spec.unit)}`,
    footer: items => { const row = rows[items[0]?.dataIndex]; return row ? `${row.observed ?? 'Unavailable'} / ${row.expected ?? 'Unavailable'} observed / expected\n${periodStatus(row, report)}` : ''; }
  };
  return config;
}
export function dailyZoneConfig(report, view) {
  const config = chartConfig('daily', report, view.series[0]?.rows || []);
  // Four calendar ticks remain legible in a 320px panel with four legend entries.
  config.options.scales.x.ticks.maxTicksLimit = 4;
  const colors = [['#1261a6', '#0a2540'], ['#527a5e', '#285138']];
  config.data.datasets = view.series.flatMap((series, index) => ['average_demand_mw', 'peak_demand_mw'].map((metric, metricIndex) => ({
    label: `${series.zoneCode} ${metricIndex === 0 ? 'average' : 'peak'}`, zoneCode: series.zoneCode,
    data: series.rows.map(row => row[metric] ?? null), borderColor: colors[index][metricIndex], backgroundColor: colors[index][metricIndex],
    borderDash: metricIndex === 0 ? [6, 3] : [], borderWidth: 2, spanGaps: false,
    pointRadius: series.rows.map(row => !row.missing && row.observed !== row.expected ? 4 : view.dates.length < 40 ? 2 : 0),
    pointStyle: series.rows.map(row => row.observed !== row.expected ? 'triangle' : 'circle'), pointHoverRadius: 5
  })));
  config.options.plugins.tooltip.callbacks.footer = items => {
    const index = items[0]?.dataIndex;
    return index === undefined ? '' : view.series.map(series => { const row = series.rows[index]; return `${series.zoneCode}: ${row.observed ?? 'Unavailable'} / ${row.expected ?? 'Unavailable'} observed / expected · ${periodStatus(row, report)}`; }).join('\n');
  };
  return config;
}
export function zonePeaksConfig(summary, rows) {
  const config = horizontalConfig(rows, rows.map(row => row.demandMW), 'Reporting-period peak demand', 'MW');
  config.options.plugins.tooltip.callbacks = {
    title: items => items[0] ? zoneLabel(rows[items[0].dataIndex].zoneCode) : '',
    label: item => `Reporting-period peak: ${formatValue(item.parsed.x, 'MW')}`,
    footer: items => items[0] ? `${reportingPeriod(summary.metadata)}\n${peakTiming(rows[items[0].dataIndex], summary.metadata.timezone)}` : ''
  };
  return config;
}

