// Schema 1.0.0 consumer. No DOM access or requests occur on import.
export const PRODUCTION_MANIFEST = 'https://www.schleigeranalytics.com/data/ercot/manifest.json';
export const REQUIRED_FILES = Object.freeze(['schema.json', 'summary.json', 'coverage.json', 'daily/system.json', 'daily/zones.json', 'monthly/system.json', 'monthly/zones.json', 'peaks/system.json', 'peaks/zones.json']);
const ZONES = ['COAST', 'EAST', 'ERCOT', 'FWEST', 'NCENT', 'NORTH', 'SCENT', 'SOUTH', 'WEST'];
const HASH = /^[a-f0-9]{64}$/;

export class ErcotDataError extends Error {
  constructor(code, message) { super(message); this.name = 'ErcotDataError'; this.code = code; }
}
function requireValue(condition, message) {
  if (!condition) throw new ErcotDataError('invalid', `Invalid ERCOT data: ${message}.`);
}
function object(value, fields, label) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  requireValue(fields.every(key => Object.hasOwn(value, key)), `${label} is missing required fields`);
  requireValue(Object.keys(value).every(key => fields.includes(key)), `${label} has unsupported fields`);
}
function count(value, label, minimum = 0) {
  requireValue(Number.isSafeInteger(value) && value >= minimum, `${label} must be a valid count`);
  return value;
}
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function localTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?$/.test(value) && isDate(value.slice(0, 10));
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function validateMetadata(value) {
  object(value, ['schema_version', 'generated_at', 'reporting_range', 'dataset_coverage', 'selected_zones', 'units', 'quality', 'timezone', 'decimal_encoding'], 'metadata');
  if (value.schema_version !== '1.0.0') throw new ErcotDataError('version', 'This dataset schema version is not supported. Please try again after the dashboard is updated.');
  requireValue(typeof value.generated_at === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?Z$/.test(value.generated_at) && isDate(value.generated_at.slice(0, 10)), 'generation timestamp must be UTC');
  object(value.reporting_range, ['start', 'end_exclusive'], 'reporting range');
  const range = value.reporting_range;
  requireValue(isDate(range.start) && isDate(range.end_exclusive) && range.start < range.end_exclusive, 'reporting range');
  object(value.dataset_coverage, ['first', 'last', 'observation_count'], 'dataset coverage');
  const extent = value.dataset_coverage;
  count(extent.observation_count, 'dataset observation count');
  requireValue(extent.observation_count === 0 ? extent.first === null && extent.last === null : isDate(extent.first) && isDate(extent.last) && extent.first <= extent.last, 'dataset coverage dates');
  requireValue(Array.isArray(value.selected_zones) && value.selected_zones.includes('ERCOT') && new Set(value.selected_zones).size === value.selected_zones.length && value.selected_zones.every(zone => ZONES.includes(zone)), 'selected zones');
  requireValue(['complete', 'incomplete', 'empty'].includes(value.quality), 'quality');
  requireValue(value.timezone === 'America/Chicago' && value.decimal_encoding === 'string', 'timezone or decimal encoding');
  object(value.units, ['demand', 'energy', 'contribution_fraction', 'contribution_percent'], 'units');
  requireValue(value.units.demand === 'MW' && value.units.energy === 'MWh' && value.units.contribution_fraction === '1' && value.units.contribution_percent === '%', 'units');
  // Canonical copies permit metadata comparisons independent of JSON key order.
  return {
    schema_version: value.schema_version, generated_at: value.generated_at,
    reporting_range: { start: range.start, end_exclusive: range.end_exclusive },
    dataset_coverage: { first: extent.first, last: extent.last, observation_count: extent.observation_count },
    selected_zones: [...value.selected_zones],
    units: { demand: 'MW', energy: 'MWh', contribution_fraction: '1', contribution_percent: '%' },
    quality: value.quality, timezone: value.timezone, decimal_encoding: value.decimal_encoding
  };
}
export function validateManifestURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new ErcotDataError('url', 'The ERCOT manifest URL is invalid.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  requireValue((url.origin === 'https://www.schleigeranalytics.com' || (local && ['http:', 'https:'].includes(url.protocol))) && url.pathname === '/data/ercot/manifest.json' && !url.username && !url.password && !url.search && !url.hash, 'manifest URL is outside the permitted data location');
  return url;
}
export function resolveReportURL(manifestURL, generation, name, entry) {
  const base = validateManifestURL(manifestURL);
  requireValue(typeof generation === 'string' && HASH.test(generation), 'generation identifier');
  requireValue(REQUIRED_FILES.includes(name) || name === 'contributions/hourly.json', 'report filename');
  object(entry, ['path', 'sha256', 'bytes'], 'file entry');
  // Exact canonical paths exclude absolute URLs, traversal, encoding, queries and fragments.
  requireValue(entry.path === `generations/${generation}/${name}`, 'report path must match its generation and logical filename');
  requireValue(typeof entry.sha256 === 'string' && HASH.test(entry.sha256), 'report checksum');
  count(entry.bytes, 'report byte size', 1);
  const url = new URL(entry.path, base);
  requireValue(url.origin === base.origin && url.pathname === `/data/ercot/generations/${generation}/${name}` && !url.search && !url.hash, 'report URL');
  return url.href;
}
export function parseManifest(value, manifestURL) {
  object(value, ['metadata', 'generation', 'files'], 'manifest');
  const metadata = validateMetadata(value.metadata);
  requireValue(typeof value.generation === 'string' && HASH.test(value.generation), 'generation identifier');
  requireValue(value.files !== null && typeof value.files === 'object' && !Array.isArray(value.files), 'manifest files');
  requireValue(REQUIRED_FILES.every(name => Object.hasOwn(value.files, name)), 'manifest is missing required reports');
  const files = {};
  for (const [name, entry] of Object.entries(value.files)) {
    const url = resolveReportURL(manifestURL, value.generation, name, entry);
    files[name] = { ...entry, url };
  }
  return freeze({ generation: value.generation, metadata, files });
}
function validatePeak(value, metadata, expectedZone) {
  object(value, ['zone_code', 'demand_mw', 'reporting_date', 'hour_ending_local', 'occurrence', 'hour_ending_raw'], 'peak');
  requireValue(value.zone_code === expectedZone && metadata.selected_zones.includes(expectedZone), 'peak zone');
  requireValue(typeof value.demand_mw === 'string' && /^\d+(\.\d+)?$/.test(value.demand_mw) && Number.isFinite(Number(value.demand_mw)), 'peak demand');
  requireValue(isDate(value.reporting_date) && value.reporting_date >= metadata.reporting_range.start && value.reporting_date < metadata.reporting_range.end_exclusive, 'peak reporting date');
  requireValue(localTime(value.hour_ending_local), 'peak local hour ending');
  const nextDay = new Date(`${value.reporting_date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  requireValue(value.hour_ending_local.slice(0, 10) === value.reporting_date || value.hour_ending_local === `${nextDay.toISOString().slice(0, 10)}T00:00:00`, 'peak hour ending must belong to its reporting day');
  count(value.occurrence, 'peak occurrence', 1);
  requireValue(typeof value.hour_ending_raw === 'string' && value.hour_ending_raw.trim().length > 0, 'raw hour-ending label');
  return { zoneCode: expectedZone, demandExact: value.demand_mw, demandMW: Number(value.demand_mw), reportingDate: value.reporting_date, hourEndingLocal: value.hour_ending_local, hourEndingRaw: value.hour_ending_raw, occurrence: value.occurrence };
}
function validateCoverage(value, metadata) {
  object(value, ['zone_code', 'observation_count', 'distinct_hour_label_count', 'repeated_hour_observation_count', 'first_hour_ending_local', 'last_hour_ending_local', 'expected_observation_count', 'missing_observation_count', 'unexpected_observation_count'], 'coverage row');
  requireValue(metadata.selected_zones.includes(value.zone_code), 'coverage zone');
  for (const field of ['observation_count', 'distinct_hour_label_count', 'repeated_hour_observation_count', 'missing_observation_count', 'unexpected_observation_count']) count(value[field], field);
  count(value.expected_observation_count, 'expected observations', 1);
  requireValue(value.observation_count + value.missing_observation_count === value.expected_observation_count + value.unexpected_observation_count, 'coverage counts do not reconcile');
  requireValue(value.distinct_hour_label_count <= value.observation_count && value.repeated_hour_observation_count <= value.observation_count, 'hour label counts exceed observations');
  requireValue(value.observation_count === 0 ? value.first_hour_ending_local === null && value.last_hour_ending_local === null : localTime(value.first_hour_ending_local) && localTime(value.last_hour_ending_local) && value.first_hour_ending_local <= value.last_hour_ending_local, 'coverage hour-ending bounds');
  return { zoneCode: value.zone_code, observed: value.observation_count, expected: value.expected_observation_count, missing: value.missing_observation_count, unexpected: value.unexpected_observation_count, firstHourEndingLocal: value.first_hour_ending_local, lastHourEndingLocal: value.last_hour_ending_local };
}
export function normalizeSummary(value, manifest) {
  object(value, ['metadata', 'system_peak', 'zone_peaks', 'coverage', 'observation_count'], 'summary');
  const metadata = validateMetadata(value.metadata);
  requireValue(JSON.stringify(metadata) === JSON.stringify(manifest.metadata), 'summary metadata differs from the captured manifest');
  requireValue(Array.isArray(value.coverage) && Array.isArray(value.zone_peaks), 'summary arrays');
  const coverage = value.coverage.map(row => validateCoverage(row, metadata));
  requireValue(coverage.length === metadata.selected_zones.length && new Set(coverage.map(row => row.zoneCode)).size === coverage.length, 'coverage must contain every selected series exactly once');
  const observationCount = count(value.observation_count, 'summary observation count');
  requireValue(coverage.reduce((sum, row) => sum + row.observed, 0) === observationCount && observationCount <= metadata.dataset_coverage.observation_count, 'summary counts do not reconcile');
  const quality = observationCount === 0 ? 'empty' : coverage.some(row => row.missing || row.unexpected) ? 'incomplete' : 'complete';
  requireValue(metadata.quality === quality, 'quality does not match coverage');
  const systemCoverage = coverage.find(row => row.zoneCode === 'ERCOT');
  requireValue(systemCoverage.observed > 0 ? value.system_peak !== null : value.system_peak === null, 'system peak presence does not match coverage');
  const systemPeak = value.system_peak === null ? null : validatePeak(value.system_peak, metadata, 'ERCOT');
  const zonePeaks = value.zone_peaks.map(peak => {
    requireValue(peak !== null && typeof peak === 'object' && peak.zone_code !== 'ERCOT', 'zone peak');
    return validatePeak(peak, metadata, peak.zone_code);
  });
  const observedZones = coverage.filter(row => row.zoneCode !== 'ERCOT' && row.observed > 0).map(row => row.zoneCode);
  requireValue(new Set(zonePeaks.map(peak => peak.zoneCode)).size === zonePeaks.length && zonePeaks.length === observedZones.length && zonePeaks.every(peak => observedZones.includes(peak.zoneCode)), 'zone peaks do not match coverage');
  return freeze({ generation: manifest.generation, metadata, systemPeak, zonePeaks, coverage, systemCoverage, observationCount, weatherZoneCount: metadata.selected_zones.filter(zone => zone !== 'ERCOT').length });
}
async function fetchJSON(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { signal: controller.signal, cache: 'default', credentials: 'omit', redirect: 'error' });
        if (!response.ok) throw new ErcotDataError('http', `The ERCOT data request failed (HTTP ${response.status}). Please retry.`);
        requireValue(/\bapplication\/json\b/i.test(response.headers.get('content-type') || ''), 'response is not JSON');
        try { return await response.json(); }
        catch (error) { if (controller.signal.aborted) throw error; throw new ErcotDataError('json', 'The ERCOT response contains malformed JSON. Please retry.'); }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { reject(new ErcotDataError('timeout', 'The ERCOT data request timed out. Please retry.')); controller.abort(); }, timeoutMs);
      })
    ]);
  } catch (error) {
    if (error instanceof ErcotDataError) throw error;
    throw new ErcotDataError('network', 'The ERCOT data could not be reached. Check your connection and retry.');
  } finally { clearTimeout(timer); }
}
export function createDataClient({ manifestURL = PRODUCTION_MANIFEST, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const url = validateManifestURL(manifestURL).href;
  let manifestPromise;
  const reports = new Map();
  function manifest() {
    if (!manifestPromise) {
      manifestPromise = fetchJSON(url, fetchImpl, timeoutMs).then(value => parseManifest(value, url)).catch(error => { manifestPromise = undefined; throw error; });
    }
    return manifestPromise;
  }
  function report(name) {
    if (!['summary.json', 'daily/system.json', 'monthly/system.json', 'daily/zones.json', 'monthly/zones.json'].includes(name)) return Promise.reject(new ErcotDataError('invalid', 'This report is outside the dashboard scope.'));
    if (!reports.has(name)) {
      const pending = manifest().then(async snapshot => {
        const value = await fetchJSON(snapshot.files[name].url, fetchImpl, timeoutMs);
        return name === 'summary.json' ? normalizeSummary(value, snapshot) : (name.endsWith('/zones.json') ? normalizeZoneReport(value, snapshot, name.split('/')[0]) : normalizeSystemReport(value, snapshot, name.split('/')[0]));
      }).catch(error => { reports.delete(name); throw error; });
      reports.set(name, pending);
    }
    return reports.get(name);
  }
  return Object.freeze({ load: () => report('summary.json'), loadReport: report });
}
// System and zone aggregate reports share the captured metadata contract. Decimal strings
// remain available for inspection; numeric copies are used only for display.
export function normalizeSystemReport(value, manifest, kind) { return normalizeAggregateReport(value, manifest, kind, false); }
export function normalizeZoneReport(value, manifest, kind) { return normalizeAggregateReport(value, manifest, kind, true); }
function normalizeAggregateReport(value, manifest, kind, zones) {
  requireValue(['daily', 'monthly'].includes(kind), 'system report kind');
  object(value, ['metadata', 'rows'], `${kind} report`);
  const metadata = validateMetadata(value.metadata);
  requireValue(JSON.stringify(metadata) === JSON.stringify(manifest.metadata), `${kind} metadata differs from the captured manifest`);
  requireValue(Array.isArray(value.rows), `${kind} rows`);
  const dateField = kind === 'daily' ? 'reporting_date' : 'reporting_month';
  const metricFields = ['average_demand_mw', 'peak_demand_mw', 'energy_mwh'];
  if (kind === 'daily') metricFields.push('minimum_demand_mw');
  const seen = new Set();
  const rows = value.rows.map(row => {
    object(row, ['zone_code', dateField, 'observation_count', 'expected_observation_count', ...metricFields], `${kind} row`);
    requireValue(zones ? row.zone_code !== 'ERCOT' && metadata.selected_zones.includes(row.zone_code) : row.zone_code === 'ERCOT', zones ? 'zone report contains an unselected or system series' : 'system report must contain only ERCOT');
    const date = row[dateField];
    requireValue(isDate(date), `${kind} reporting date`);
    const { start, end_exclusive: end } = metadata.reporting_range;
    requireValue(kind === 'daily' ? date >= start && date < end : date.endsWith('-01') && date >= `${start.slice(0, 7)}-01` && date < end, `${kind} date outside reporting range`);
    requireValue(!seen.has(zones ? `${row.zone_code}/${date}` : date), `duplicate ${kind} period`);
    seen.add(zones ? `${row.zone_code}/${date}` : date);
    const observed = count(row.observation_count, 'observed records');
    const expected = count(row.expected_observation_count, 'expected records', 1);
    const numbers = {};
    const exact = {};
    for (const field of metricFields) {
      requireValue(typeof row[field] === 'string' && /^\d+(\.\d+)?$/.test(row[field]) && Number.isFinite(Number(row[field])), `${kind} ${field}`);
      exact[field] = row[field];
      numbers[field] = observed === 0 ? null : Number(row[field]);
    }
    requireValue(Number(row.average_demand_mw) <= Number(row.peak_demand_mw), 'average exceeds peak demand');
    if (kind === 'daily') requireValue(Number(row.minimum_demand_mw) <= Number(row.average_demand_mw), 'minimum exceeds average demand');
    return { date, observed, expected, exact, ...numbers, ...(zones ? { zoneCode: row.zone_code } : {}) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return freeze({ generation: manifest.generation, metadata, kind, rows, ...(zones ? { zoneCodes: metadata.selected_zones.filter(zone => zone !== 'ERCOT') } : {}) });
}




