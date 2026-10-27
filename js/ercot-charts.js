import { chartConfig, dailyBounds, filterDaily, monthlyMetric, monthlyRows, periodStatus, isPartialMonth, formatValue } from './ercot-chart-model.js';

let libraryPromise;
export function chartLibrary() {
  if (globalThis.Chart?.version === '4.6.1') return Promise.resolve(globalThis.Chart);
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./vendor/chart-4.6.1.umd.min.js', import.meta.url).href;
      script.onload = () => {
        if (globalThis.Chart?.version === '4.6.1') resolve(globalThis.Chart);
        else { script.remove(); reject(new Error('The chart library version is unavailable. Data tables remain available.')); }
      };
      script.onerror = () => { script.remove(); reject(new Error('The chart library could not load. Data tables remain available. Please retry.')); };
      document.head.append(script);
    }).catch(error => { libraryPromise = undefined; throw error; });
  }
  return libraryPromise;
}
function tableRows(body, rows, report, metric) {
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = report.kind === 'monthly' ? row.date.slice(0, 7) : row.date;
    tr.append(th);
    const fields = report.kind === 'daily' ? ['average_demand_mw', 'peak_demand_mw', 'minimum_demand_mw'] : [metric];
    const values = [...fields.map(field => formatValue(row[field])), `${row.observed ?? 'Unavailable'} / ${row.expected ?? 'Unavailable'}`, periodStatus(row, report)];
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    fragment.append(tr);
  }
  body.replaceChildren(fragment);
}
export function initializeSystemCharts(client) {
  for (const kind of ['daily', 'monthly']) initializePanel(kind, client);
}
function initializePanel(kind, client) {
  const monthly = kind === 'monthly';
  const panel = document.querySelector(`#ercot-${kind}-panel`);
  const status = panel.querySelector('[role="status"]');
  const retry = panel.querySelector('.ercot-chart-retry');
  const badge = panel.querySelector('.ercot-badge');
  const fieldset = panel.querySelector('fieldset');
  const frame = panel.querySelector('.ercot-chart-frame');
  const canvas = panel.querySelector('canvas');
  const table = panel.querySelector('details');
  const body = panel.querySelector('tbody');
  const metric = panel.querySelector('select');
  const start = panel.querySelector('[name="start"]');
  const end = panel.querySelector('[name="end"]');
  const minimum = panel.querySelector('[name="minimum"]');
  const filterError = panel.querySelector('.ercot-filter-error');
  let report;
  let rows = [];
  let chart;
  let loading = false;
  let rendering = 0;
  function reportRows() {
    return monthly ? monthlyRows(report) : filterDaily(report, start.value, end.value);
  }
  function fail(error) {
    badge.textContent = 'Chart unavailable';
    status.textContent = error.message || 'This chart is unavailable. Please retry.';
    retry.hidden = false;
    frame.hidden = true;
  }
  async function draw() {
    const revision = ++rendering;
    rows = reportRows();
    const key = monthly ? metric.value : undefined;
    const spec = monthly ? monthlyMetric(key) : null;
    tableRows(body, rows, report, key);
    if (monthly) {
      panel.querySelector('.ercot-metric-heading').textContent = `${spec.label} (${spec.unit})`;
      panel.querySelector('caption').textContent = `Monthly system ${spec.label.toLowerCase()} (${spec.unit}); published reporting period, independent of the daily filter`;
    }
    table.hidden = false;
    const available = rows.some(row => !row.missing && row.observed > 0);
    if (!available) {
      if (chart) { chart.destroy(); chart = undefined; }
      frame.hidden = true;
      badge.textContent = 'No observations';
      status.textContent = 'No system observations in this range. Missing demand and energy are unavailable, not zero.';
      retry.hidden = true;
      return;
    }
    canvas.setAttribute('aria-label', monthly ? `ERCOT monthly ` + spec.label.toLowerCase() + ` bar chart, in ` + spec.unit : `ERCOT daily average and peak` + (minimum.checked ? `, and minimum` : ``) + ` demand line chart, in MW`);
    const Chart = await chartLibrary();
    if (revision !== rendering) return;
    if (chart) chart.destroy();
    Chart.getChart(canvas)?.destroy();
    frame.hidden = false;
    chart = new Chart(canvas, chartConfig(kind, report, rows, key, !monthly && minimum.checked));
    if (!chart.ctx) throw new Error('Canvas charts are unavailable in this browser. Use the supporting data table.');
    const missing = rows.filter(row => row.missing || row.observed === 0).length;
    const mismatches = rows.filter(row => !row.missing && row.observed !== row.expected).length;
    const partialMonths = rows.filter(row => !row.missing && row.observed > 0 && isPartialMonth(row, report)).length;
    badge.textContent = missing || mismatches || partialMonths || report.metadata.quality !== 'complete' ? 'Review coverage' : 'Chart loaded';
    status.textContent = `${monthly ? 'Published monthly aggregates' : `${start.value} through ${end.value}`}: ${rows.length} ${monthly ? 'months' : 'days'}, ${missing} with no observations, ${mismatches} with count mismatches${monthly ? `, ${partialMonths} partial calendar months` : ''}.${report.metadata.quality !== 'complete' ? ' Dataset coverage needs review; counts alone do not prove completeness.' : ''}`;
    retry.hidden = true;
  }
  async function load() {
    if (loading) return;
    loading = true;
    const hadFocus = document.activeElement === retry;
    retry.disabled = true;
    fieldset.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    badge.textContent = 'Loading report';
    status.textContent = `Loading ${kind} system demand…`;
    try {
      report = await client.loadReport(`${kind}/system.json`);
      if (!monthly) {
        const bounds = dailyBounds(report);
        for (const input of [start, end]) { input.min = bounds?.start || ''; input.max = bounds?.end || ''; }
        if (!start.value) start.value = bounds?.start || '';
        if (!end.value) end.value = bounds?.end || '';
      }
      await draw();
    } catch (error) { fail(error); }
    finally {
      loading = false;
      retry.disabled = false;
      fieldset.disabled = !report?.rows.some(row => row.observed > 0);
      panel.setAttribute('aria-busy', 'false');
      if (retry.hidden && hadFocus && (document.activeElement === retry || document.activeElement === document.body)) status.focus();
    }
  }
  const update = async () => {
    try { await draw(); }
    catch (error) { fail(error); }
  };
  retry.addEventListener('click', load);
  if (monthly) metric.addEventListener('change', update);
  else {
    panel.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      try { reportRows(); filterError.hidden = true; update(); }
      catch (error) { filterError.textContent = error.message; filterError.hidden = false; }
    });
    minimum.addEventListener('change', () => {
      // An edited, unapplied date range must not invalidate the existing chart.
      try { reportRows(); filterError.hidden = true; update(); }
      catch (error) { filterError.textContent = error.message; filterError.hidden = false; }
    });
  }
  load();
}


