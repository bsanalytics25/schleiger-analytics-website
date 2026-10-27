import { createDataClient } from './ercot-data.js';
import { initializeSystemCharts } from './ercot-charts.js';
import { initializeZoneCharts } from './ercot-zone-charts.js';

const panel = document.querySelector('.ercot-status');
const status = document.querySelector('#ercot-load-status');
const retry = document.querySelector('#ercot-retry');
const client = createDataClient({ manifestURL: new URL('/data/ercot/manifest.json', location.origin).href });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US');
function set(id, value) { document.getElementById(id).textContent = value; }
function date(value) {
  if (value === null) return 'Unavailable';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}
function periodEnd(exclusive) {
  const end = new Date(`${exclusive}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return date(end.toISOString().slice(0, 10));
}
function render(data) {
  const { metadata, systemPeak, systemCoverage } = data;
  const range = metadata.reporting_range;
  const extent = metadata.dataset_coverage;
  set('ercot-reporting-period', `${date(range.start)} – ${periodEnd(range.end_exclusive)}`);
  set('ercot-measurement-coverage', extent.first === null ? 'No measurements in the dataset' : `${date(extent.first)} – ${date(extent.last)}`);
  const timestamp = document.querySelector('#ercot-generated');
  timestamp.dateTime = metadata.generated_at;
  timestamp.textContent = `${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(metadata.generated_at))} UTC`;
  const labels = { complete: 'Complete for the reporting period', incomplete: 'Incomplete — see coverage details', empty: 'Empty reporting period' };
  set('ercot-quality', labels[metadata.quality]);
  set('ercot-timezone', metadata.timezone);
  set('ercot-method-coverage', extent.first === null ? 'No measurements in the published dataset.' : `Published measurement coverage: ${date(extent.first)} – ${date(extent.last)}.`);
  set('ercot-weather-zones', integer.format(data.weatherZoneCount));
  set('ercot-peak-demand', systemPeak === null ? 'Unavailable' : `${number.format(systemPeak.demandMW)} MW`);
  set('ercot-peak-date', systemPeak === null ? 'Unavailable' : date(systemPeak.reportingDate));
  // These are local labels, not UTC instants. Retain midnight's own date and DST occurrence.
  set('ercot-peak-hour', systemPeak === null ? 'No system observations in this reporting period.' : `Hour ending ${systemPeak.hourEndingLocal.replace('T', ' ')} · ${metadata.timezone} · occurrence ${systemPeak.occurrence}`);
  set('ercot-system-coverage', `${integer.format(systemCoverage.observed)} / ${integer.format(systemCoverage.expected)}`);
  set('ercot-system-coverage-note', `Observed / expected hourly records · ${integer.format(systemCoverage.missing)} missing · ${integer.format(systemCoverage.unexpected)} unexpected`);
  const body = document.querySelector('#ercot-coverage-rows');
  const fragment = document.createDocumentFragment();
  for (const row of data.coverage) {
    const tr = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = row.zoneCode === 'ERCOT' ? 'ERCOT system' : row.zoneCode;
    tr.append(name);
    for (const value of [row.observed, row.expected, row.missing, row.unexpected]) {
      const td = document.createElement('td');
      td.textContent = integer.format(value);
      tr.append(td);
    }
    fragment.append(tr);
  }
  body.replaceChildren(fragment);
  document.querySelector('#ercot-coverage-details').hidden = false;
  set('ercot-dataset-note', 'Measurement coverage describes the dataset extent and may differ from the reporting period. The export timestamp describes file generation, not the most recent measurement. This is historical analysis, not live grid monitoring.');
  const badge = document.querySelector('#ercot-status-badge');
  badge.textContent = { complete: 'Summary loaded', incomplete: 'Coverage warning', empty: 'No observations' }[metadata.quality];
  badge.dataset.quality = metadata.quality;
  status.textContent = metadata.quality === 'complete' ? 'Summary loaded. Coverage is complete for the published reporting period. System charts load independently below.' : metadata.quality === 'empty' ? 'No observations in the published reporting period. Missing values are unavailable, not zero demand.' : 'Summary loaded with incomplete coverage. Observed peaks may understate the full reporting-period peak. Review missing and unexpected records below.';
}
async function load() {
  const retryHadFocus = document.activeElement === retry;
  retry.disabled = true;
  panel.setAttribute('aria-busy', 'true');
  set('ercot-status-badge', 'Loading summary');
  status.textContent = 'Loading dataset status and reporting-period indicators…';
  try {
    render(await client.load());
    retry.hidden = true;
  } catch (error) {
    set('ercot-status-badge', 'Summary unavailable');
    status.textContent = error.message || 'The ERCOT summary is unavailable. Please retry.';
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      status.textContent += ' For local data, start the development preview with node scripts/serve-ercot-preview.mjs.';
    }
    retry.hidden = false;
  } finally {
    panel.setAttribute('aria-busy', 'false');
    retry.disabled = false;
    // A successful retry hides its focused button; keep focus in the result.
    if (retry.hidden && retryHadFocus && (document.activeElement === retry || document.activeElement === document.body)) status.focus();
  }
}
initializeSystemCharts(client);
initializeZoneCharts(client);
retry.addEventListener('click', load);
load();





