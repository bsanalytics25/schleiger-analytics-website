import { chartLibrary } from './ercot-charts.js';
import { formatValue, periodStatus, isPartialMonth } from './ercot-chart-model.js';
import { zoneLabel, zoneMonthPeriods, monthlyZoneView, zoneDailyBounds, dailyZoneView, zonePeakRows, sortZonePeaks, peakTiming, reportingPeriod, monthlyZoneConfig, dailyZoneConfig, zonePeaksConfig } from './ercot-zone-model.js';

function options(select, values, label, includeNone = false) {
  const fragment = document.createDocumentFragment();
  for (const value of includeNone ? ['', ...values] : values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value ? label(value) : 'No comparison';
    fragment.append(option);
  }
  select.replaceChildren(fragment);
}
function tableRows(body, rows) {
  const fragment = document.createDocumentFragment();
  for (const values of rows) {
    const tr = document.createElement('tr');
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) cell.scope = 'row';
      cell.textContent = value;
      tr.append(cell);
    });
    fragment.append(tr);
  }
  body.replaceChildren(fragment);
}
export function initializeZoneCharts(client) {
  for (const kind of ['monthly', 'daily', 'peaks']) initializeZonePanel(kind, client);
}
function initializeZonePanel(kind, client) {
  const panel = document.querySelector(`#ercot-zone-${kind}-panel`);
  const status = panel.querySelector('[role="status"]');
  const badge = panel.querySelector('.ercot-badge');
  const retry = panel.querySelector('.ercot-zone-retry');
  const frame = panel.querySelector('.ercot-chart-frame');
  const canvas = panel.querySelector('canvas');
  const table = panel.querySelector('.ercot-zone-table');
  const body = panel.querySelector('tbody');
  const filterError = panel.querySelector('.ercot-filter-error');
  const primary = panel.querySelector('[name="zone"]');
  const secondary = panel.querySelector('[name="compare"]');
  const start = panel.querySelector('[name="start"]');
  const end = panel.querySelector('[name="end"]');
  const period = panel.querySelector('[name="period"]');
  const metric = panel.querySelector('[name="metric"]');
  let report, chart, loading = false, revision = 0;
  let sortKey = 'demand', sortDirection = 'descending';
  const zones = () => secondary?.value ? [primary.value, secondary.value] : [primary?.value];
  function configureDates() {
    for (const option of secondary.options) option.disabled = option.value === primary.value;
    if (secondary.value === primary.value) secondary.value = '';
    const bounds = zoneDailyBounds(report, zones());
    for (const input of [start, end]) {
      input.min = bounds?.start || '';
      input.max = bounds?.end || '';
      input.disabled = !bounds;
    }
    panel.querySelector('[type="submit"]').disabled = !bounds;
    start.value = bounds ? start.value && start.value >= bounds.start && start.value <= bounds.end ? start.value : bounds.start : '';
    end.value = bounds ? end.value && end.value >= start.value && end.value <= bounds.end ? end.value : bounds.end : '';
  }
  function configure() {
    if (kind === 'monthly') {
      if (!period.options.length) {
        const periods = zoneMonthPeriods(report);
        options(period, periods, value => value.slice(0, 7));
        const observed = report.rows.filter(row => row.observed > 0).map(row => row.date).sort();
        period.value = observed.at(-1) || periods.at(-1) || '';
      }
    } else if (kind === 'daily' && !primary.options.length) {
      options(primary, report.zoneCodes, zoneLabel);
      options(secondary, report.zoneCodes, zoneLabel, true);
      if (report.zoneCodes.length) {
        primary.value = report.zoneCodes.find(zone => report.rows.some(row => row.zoneCode === zone && row.observed > 0)) || report.zoneCodes[0];
        configureDates();
      }
    }
  }
  function view() {
    if (kind === 'monthly') return monthlyZoneView(report, period.value, metric.value);
    if (kind === 'daily') return report.zoneCodes.length ? dailyZoneView(report, zones(), start.value, end.value) : { dates: [], series: [] };
    return sortZonePeaks(zonePeakRows(report), sortKey, sortDirection);
  }
  function fail(error) {
    badge.textContent = 'Panel unavailable';
    status.textContent = error.message || 'This weather-zone panel is unavailable. Please retry.';
    frame.hidden = true;
    retry.hidden = false;
  }
  async function draw() {
    const current = ++revision;
    const data = view();
    let config, available, message;
    if (kind === 'monthly') {
      const { rows, specification: spec } = data;
      panel.querySelector('.ercot-zone-metric-heading').textContent = `${spec.label} (${spec.unit})`;
      panel.querySelector('caption').textContent = `${period.value.slice(0, 7)} weather-zone ${spec.label.toLowerCase()} (${spec.unit}); published monthly aggregates`;
      tableRows(body, rows.map(row => [zoneLabel(row.zoneCode), formatValue(row[data.metric]), `${row.observed ?? 'Unavailable'} / ${row.expected ?? 'Unavailable'}`, periodStatus(row, report)]));
      const missing = rows.filter(row => row.missing || row.observed === 0).length;
      const mismatches = rows.filter(row => !row.missing && row.observed !== row.expected).length;
      const partial = rows.filter(row => !row.missing && row.observed > 0 && isPartialMonth(row, report)).length;
      message = `${period.value.slice(0, 7)}: ${rows.length} selected weather zones, ${missing} without observations, ${mismatches} with count mismatches, ${partial} partial calendar-month aggregates.`;
      available = rows.some(row => !row.missing && row.observed > 0);
      config = monthlyZoneConfig(report, data);
      canvas.setAttribute('aria-label', `${period.value.slice(0, 7)} weather-zone ${spec.label.toLowerCase()} comparison, in ${spec.unit}`);
    } else if (kind === 'daily') {
      const rows = data.dates.flatMap((date, index) => data.series.map(series => series.rows[index]));
      panel.querySelector('caption').textContent = `Daily average and peak demand (MW) for ${zones().filter(Boolean).join(' and ')}; ${start.value || 'no observed start'} through ${end.value || 'no observed end'}`;
      tableRows(body, rows.map(row => [row.date, zoneLabel(row.zoneCode), formatValue(row.average_demand_mw), formatValue(row.peak_demand_mw), `${row.observed ?? 'Unavailable'} / ${row.expected ?? 'Unavailable'}`, periodStatus(row, report)]));
      const missing = rows.filter(row => row.missing || row.observed === 0).length;
      const mismatches = rows.filter(row => !row.missing && row.observed !== row.expected).length;
      message = `${data.series.map(series => series.zoneCode).join(' and ')}: ${data.dates.length} reporting dates; ${missing} zone-days without observations, ${mismatches} with count mismatches.`;
      available = rows.some(row => !row.missing && row.observed > 0);
      config = dailyZoneConfig(report, data);
      canvas.setAttribute('aria-label', `${data.series.map(series => series.zoneCode).join(' and ')} daily average and peak demand, in MW`);
    } else {
      panel.querySelector('caption').textContent = `Independent zone peaks for reporting period ${reportingPeriod(report.metadata)}; timezone ${report.metadata.timezone}`;
      panel.querySelector('.ercot-zone-peak-period').textContent = `Reporting period: ${reportingPeriod(report.metadata)} (inclusive). These are observed peaks, not all-time records.`;
      tableRows(body, data.map(row => [zoneLabel(row.zoneCode), formatValue(row.demandMW), peakTiming(row, report.metadata.timezone)]));
      for (const th of panel.querySelectorAll('[data-sort-key]')) th.setAttribute('aria-sort', th.dataset.sortKey === sortKey ? sortDirection : 'none');
      message = `${data.length} selected weather zones, sorted by ${sortKey === 'demand' ? 'peak MW' : sortKey === 'timing' ? 'peak timing' : 'zone'} ${sortDirection}. ${data.filter(row => row.demandMW === null).length} unavailable peaks.`;
      available = data.some(row => row.demandMW !== null);
      config = zonePeaksConfig(report, data);
    }
    table.hidden = false;
    if (!available) {
      chart?.destroy(); chart = undefined;
      frame.hidden = true;
      badge.textContent = 'No observations';
      status.textContent = `${message} Missing values are unavailable, not zero.`;
      retry.hidden = true;
      return;
    }
    const Chart = await chartLibrary();
    if (current !== revision) return;
    chart?.destroy();
    Chart.getChart(canvas)?.destroy();
    frame.hidden = false;
    chart = new Chart(canvas, config);
    if (!chart.ctx) throw new Error('Canvas charts are unavailable in this browser. Use the supporting data table.');
    badge.textContent = 'Chart loaded';
    status.textContent = `${message}${report.metadata.quality !== 'complete' ? ' Review the dataset coverage audit; matching counts alone cannot prove completeness.' : ''}`;
    retry.hidden = true;
  }
  async function load() {
    if (loading) return;
    loading = true;
    const hadFocus = document.activeElement === retry;
    retry.disabled = true;
    for (const fieldset of panel.querySelectorAll('fieldset')) fieldset.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    badge.textContent = 'Loading report';
    status.textContent = kind === 'peaks' ? 'Loading zone peaks from the shared summary…' : `Loading ${kind} weather-zone data…`;
    try {
      report = await (kind === 'peaks' ? client.load() : client.loadReport(`${kind}/zones.json`));
      configure();
      await draw();
    } catch (error) { fail(error); }
    finally {
      loading = false;
      retry.disabled = false;
      for (const fieldset of panel.querySelectorAll('fieldset')) fieldset.disabled = !report || !report.zoneCodes.length;
      for (const button of panel.querySelectorAll('[data-sort-key] button')) button.disabled = !report;
      panel.setAttribute('aria-busy', 'false');
      if (retry.hidden && hadFocus && (document.activeElement === retry || document.activeElement === document.body)) status.focus();
    }
  }
  async function update() {
    try { await draw(); }
    catch (error) { fail(error); }
  }
  retry.addEventListener('click', load);
  if (kind === 'monthly') {
    period.addEventListener('change', update);
    metric.addEventListener('change', update);
  } else if (kind === 'daily') {
    for (const select of [primary, secondary]) select.addEventListener('change', () => { configureDates(); filterError.hidden = true; update(); });
    panel.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      try { view(); filterError.hidden = true; update(); }
      catch (error) { filterError.textContent = error.message; filterError.hidden = false; }
    });
    let activated = false;
    document.querySelector('#ercot-zone-daily-explorer').addEventListener('toggle', event => {
      if (event.target.open && !activated) { activated = true; load(); }
    });
  } else {
    for (const th of panel.querySelectorAll('[data-sort-key]')) th.querySelector('button').addEventListener('click', () => {
      const key = th.dataset.sortKey;
      sortDirection = key === sortKey ? sortDirection === 'ascending' ? 'descending' : 'ascending' : key === 'demand' ? 'descending' : 'ascending';
      sortKey = key;
      update();
    });
  }
  if (kind !== 'daily') load();
}
