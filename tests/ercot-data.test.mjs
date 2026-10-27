import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_FILES, PRODUCTION_MANIFEST, createDataClient, isDate, parseManifest, resolveReportURL, normalizeSummary } from '../js/ercot-data.js';
import { createPreviewServer, publicSnapshot } from '../scripts/serve-ercot-preview.mjs';

// SYNTHETIC CONTRACT DATA ONLY. No fixture is imported by the dashboard.
function fixture() {
  const generation = 'a'.repeat(64);
  const metadata = {
    schema_version: '1.0.0', generated_at: '2026-02-03T01:02:03.123456Z',
    reporting_range: { start: '2026-01-01', end_exclusive: '2026-01-02' },
    dataset_coverage: { first: '2025-12-01', last: '2026-01-31', observation_count: 100 },
    selected_zones: ['COAST', 'ERCOT'],
    units: { contribution_fraction: '1', contribution_percent: '%', demand: 'MW', energy: 'MWh' },
    quality: 'complete', timezone: 'America/Chicago', decimal_encoding: 'string'
  };
  const files = Object.fromEntries(REQUIRED_FILES.map(name => [name, { path: `generations/${generation}/${name}`, sha256: 'b'.repeat(64), bytes: 12 }]));
  const peak = zone => ({ zone_code: zone, demand_mw: '123.456789', reporting_date: '2026-01-01', hour_ending_local: '2026-01-02T00:00:00', occurrence: 1, hour_ending_raw: '01/01/2026 24:00' });
  const coverage = zone => ({ zone_code: zone, observation_count: 24, expected_observation_count: 24, distinct_hour_label_count: 24, repeated_hour_observation_count: 0, missing_observation_count: 0, unexpected_observation_count: 0, first_hour_ending_local: '2026-01-01T01:00:00', last_hour_ending_local: '2026-01-02T00:00:00' });
  return {
    manifest: { generation, metadata, files },
    summary: { metadata: structuredClone(metadata), observation_count: 48, system_peak: peak('ERCOT'), zone_peaks: [peak('COAST')], coverage: [coverage('COAST'), coverage('ERCOT')] }
  };
}
function normalized(f) { return normalizeSummary(f.summary, parseManifest(f.manifest, PRODUCTION_MANIFEST)); }
function both(f, edit) { edit(f.manifest.metadata); edit(f.summary.metadata); }
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const rejectsInvalid = error => error.code === 'invalid';

test('manifest resolves against its own URL and freezes an independent snapshot', () => {
  const f = fixture();
  const result = parseManifest(f.manifest, PRODUCTION_MANIFEST);
  assert.equal(result.files['summary.json'].url, `https://www.schleigeranalytics.com/data/ercot/generations/${f.manifest.generation}/summary.json`);
  f.manifest.metadata.quality = 'empty';
  assert.equal(result.metadata.quality, 'complete');
  assert.ok(Object.isFrozen(result.files['summary.json']));
  assert.throws(() => { result.metadata.selected_zones.push('EAST'); }, TypeError);
});
for (const unsafe of ['https://evil.example/report.json', '//evil.example/report.json', '/data/ercot/summary.json', '../summary.json', 'generations/../summary.json', 'generations/%2e%2e/summary.json', 'generations\\a\\summary.json', `generations/${'a'.repeat(64)}/daily/system.json`, `generations/${'c'.repeat(64)}/summary.json`, `generations/${'a'.repeat(64)}/summary.json?x=1`, `generations/${'a'.repeat(64)}/summary.json#x`]) {
  test(`reject unsafe manifest report path: ${unsafe}`, () => {
    const f = fixture(); f.manifest.files['summary.json'].path = unsafe;
    assert.throws(() => parseManifest(f.manifest, PRODUCTION_MANIFEST), rejectsInvalid);
  });
}
for (const url of ['https://evil.example/data/ercot/manifest.json', 'https://www.schleigeranalytics.com/other/manifest.json', 'https://www.schleigeranalytics.com/data/ercot/manifest.json?x=1', 'https://user:secret@www.schleigeranalytics.com/data/ercot/manifest.json', 'file:///data/ercot/manifest.json']) {
  test(`reject untrusted manifest location: ${url}`, () => assert.throws(() => createDataClient({ manifestURL: url }), rejectsInvalid));
}
test('local manifest keeps report requests same-origin on port 3000', () => {
  const f = fixture();
  assert.equal(resolveReportURL('http://localhost:3000/data/ercot/manifest.json', f.manifest.generation, 'summary.json', f.manifest.files['summary.json']), `http://localhost:3000/data/ercot/generations/${f.manifest.generation}/summary.json`);
});
for (const version of ['2.0.0', '1.1.0', '', null]) {
  test(`unsupported version: ${version}`, () => {
    const f = fixture(); f.manifest.metadata.schema_version = version;
    assert.throws(() => parseManifest(f.manifest, PRODUCTION_MANIFEST), error => error.code === 'version');
  });
}
for (const edit of [f => delete f.manifest.files['coverage.json'], f => f.manifest.files['summary.json'].bytes = 0, f => f.manifest.files['summary.json'].sha256 = 'bad', f => f.manifest.generation = 'bad', f => f.manifest.files['unknown.json'] = f.manifest.files['summary.json'], f => delete f.manifest.metadata.timezone]) {
  test(`invalid manifest entry/field ${edit}`, () => { const f = fixture(); edit(f); assert.throws(() => parseManifest(f.manifest, PRODUCTION_MANIFEST), rejectsInvalid); });
}
test('normalization retains precise decimals, units, HE24 and separate coverage extent', () => {
  const result = normalized(fixture());
  assert.equal(result.systemPeak.demandExact, '123.456789');
  assert.equal(result.systemPeak.demandMW, 123.456789);
  assert.equal(result.systemPeak.reportingDate, '2026-01-01');
  assert.equal(result.systemPeak.hourEndingLocal, '2026-01-02T00:00:00');
  assert.equal(result.weatherZoneCount, 1);
  assert.equal(result.metadata.dataset_coverage.last, '2026-01-31');
  assert.equal(result.metadata.reporting_range.end_exclusive, '2026-01-02');
  assert.equal(result.metadata.units.energy, 'MWh');
});
test('repeated fall DST hour preserves occurrence and local label', () => {
  const f = fixture();
  both(f, m => { m.reporting_range = {start:'2026-11-01',end_exclusive:'2026-11-02'}; m.dataset_coverage = {first:'2026-11-01',last:'2026-11-01',observation_count:50}; });
  for(const row of f.summary.coverage) Object.assign(row,{observation_count:25,expected_observation_count:25,first_hour_ending_local:'2026-11-01T01:00:00',last_hour_ending_local:'2026-11-02T00:00:00',repeated_hour_observation_count:1});
  for(const peak of [f.summary.system_peak,...f.summary.zone_peaks]) Object.assign(peak,{reporting_date:'2026-11-01',hour_ending_local:'2026-11-01T02:00:00',occurrence:2});
  f.summary.observation_count = 50;
  assert.equal(normalized(f).systemPeak.occurrence, 2);
});
test('missing slots are accepted as incomplete, never zero-filled', () => {
  const f = fixture(); both(f, m => m.quality = 'incomplete');
  Object.assign(f.summary.coverage[1],{observation_count:23,distinct_hour_label_count:23,missing_observation_count:1});
  f.summary.observation_count = 47;
  const result = normalized(f);
  assert.equal(result.systemCoverage.missing,1);
  assert.equal(result.systemCoverage.observed,23);
});
test('unexpected observations replacing missing ones cannot appear complete', () => {
  const f = fixture(); both(f,m => m.quality = 'incomplete');
  Object.assign(f.summary.coverage[1],{missing_observation_count:1,unexpected_observation_count:1,repeated_hour_observation_count:1});
  assert.equal(normalized(f).metadata.quality,'incomplete');
  both(f,m=>m.quality='complete');
  assert.throws(()=>normalized(f), rejectsInvalid);
});
test('empty reporting range permits null peaks despite wider database extent', () => {
  const f = fixture(); both(f,m=>m.quality='empty');
  f.summary.system_peak = null; f.summary.zone_peaks = []; f.summary.observation_count = 0;
  for(const row of f.summary.coverage) Object.assign(row,{observation_count:0,distinct_hour_label_count:0,missing_observation_count:24,first_hour_ending_local:null,last_hour_ending_local:null});
  assert.equal(normalized(f).systemPeak,null);
  assert.equal(normalized(f).metadata.dataset_coverage.observation_count,100);
  both(f,m=>m.dataset_coverage={first:null,last:null,observation_count:0});
  assert.equal(normalized(f).metadata.dataset_coverage.first,null);
});
test('a missing weather zone stays selected but need not have a peak', () => {
  const f = fixture(); both(f,m=>m.quality='incomplete');
  Object.assign(f.summary.coverage[0],{observation_count:0,distinct_hour_label_count:0,missing_observation_count:24,first_hour_ending_local:null,last_hour_ending_local:null});
  f.summary.zone_peaks=[]; f.summary.observation_count=24;
  assert.equal(normalized(f).weatherZoneCount,1);
});
for (const [name, edit] of [
  ['missing summary field', f => delete f.summary.system_peak],
  ['missing peak with observations', f => f.summary.system_peak = null],
  ['null demand', f => f.summary.system_peak.demand_mw = null],
  ['numeric demand instead of decimal string', f => f.summary.system_peak.demand_mw = 1],
  ['infinite demand', f => f.summary.system_peak.demand_mw = '9'.repeat(400)],
  ['invalid decimal', f => f.summary.system_peak.demand_mw = '1e3'],
  ['invalid date', f => f.summary.system_peak.reporting_date = '2026-02-30'],
  ['peak outside range', f => f.summary.system_peak.reporting_date = '2026-01-02'],
  ['UTC suffix on local label', f => f.summary.system_peak.hour_ending_local += 'Z'],
  ['invalid local hour', f => f.summary.system_peak.hour_ending_local = '2026-01-01T24:00:00'],
  ['invalid occurrence', f => f.summary.system_peak.occurrence = 0],
  ['missing peak field', f => delete f.summary.system_peak.hour_ending_raw],
  ['duplicate coverage zone', f => f.summary.coverage[1] = structuredClone(f.summary.coverage[0])],
  ['missing selected coverage', f => f.summary.coverage.pop()],
  ['inconsistent coverage count', f => f.summary.coverage[1].observation_count = 23],
  ['unsafe count', f => f.summary.observation_count = Number.MAX_SAFE_INTEGER + 1],
  ['wrong generation metadata', f => f.summary.metadata.generated_at = '2026-02-04T01:02:03Z'],
  ['missing zone peak', f => f.summary.zone_peaks = []],
  ['duplicate zone peak', f => f.summary.zone_peaks.push(structuredClone(f.summary.zone_peaks[0]))],
  ['unsupported units', f => f.summary.metadata.units.demand = 'GW']
]) test(`reject invalid summary: ${name}`,()=>{const f=fixture();edit(f);assert.throws(()=>normalized(f),rejectsInvalid);});
test('calendar dates reject rollover and honor leap days', () => {
  assert.equal(isDate('2026-02-30'),false); assert.equal(isDate('2024-02-29'),true); assert.equal(isDate('2026-02-29'),false);
});
test('client loads only manifest + summary, shares concurrent work and caches success', async () => {
  const f=fixture(); const calls=[];
  const client=createDataClient({fetchImpl:async(url,options)=>{calls.push({url,options});return json(url.endsWith('/manifest.json')?f.manifest:f.summary)}});
  const [a,b]=await Promise.all([client.load(),client.load()]);
  assert.strictEqual(a,b);assert.strictEqual(await client.load(),a);assert.equal(calls.length,2);
  assert.ok(calls[1].url.endsWith('/summary.json'));
  assert.equal(calls[0].options.cache,'default');assert.equal(calls[1].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');
});
test('summary failure retries same generation without re-fetching manifest', async () => {
  const f=fixture(); const calls=[];let failed=false;
  const client=createDataClient({fetchImpl:async url=>{calls.push(url);if(url.endsWith('/manifest.json'))return json(f.manifest);if(!failed){failed=true;return new Response('',{status:503})}return json(f.summary)}});
  await assert.rejects(client.load(),e=>e.code==='http');await client.load();
  assert.equal(calls.length,3);assert.equal(calls[1],calls[2]);assert.equal(calls.filter(url=>url.endsWith('/manifest.json')).length,1);
});
test('failed manifest validation is retryable with a corrected manifest', async () => {
  const f=fixture();let attempt=0;
  const client=createDataClient({fetchImpl:async url=>json(url.endsWith('/manifest.json')?++attempt===1?{...f.manifest,generation:'bad'}:f.manifest:f.summary)});
  await assert.rejects(client.load(),rejectsInvalid);await client.load();assert.equal(attempt,2);
});
for(const [name,response,code] of [
  ['network rejection',()=>{throw new TypeError('offline')},'network'],
  ['HTTP failure',()=>new Response('',{status:404}),'http'],
  ['malformed JSON',()=>new Response('{bad',{headers:{'Content-Type':'application/json'}}),'json'],
  ['HTML fallback',()=>new Response('<html></html>',{headers:{'Content-Type':'text/html'}}),'invalid']
]) test(`request failure is handled and retryable: ${name}`,async()=>{
  const f=fixture();let fail=true;
  const client=createDataClient({fetchImpl:async url=>{if(fail){fail=false;return response()}return json(url.endsWith('/manifest.json')?f.manifest:f.summary)}});
  await assert.rejects(client.load(),e=>e.code===code);await client.load();
});
test('request timeout aborts hanging fetch and can retry', async () => {
  const f=fixture();let signal;let fail=true;
  const client=createDataClient({timeoutMs:10,fetchImpl:async(url,options)=>{if(fail){signal=options.signal;return new Promise(()=>{})}return json(url.endsWith('/manifest.json')?f.manifest:f.summary)}});
  await assert.rejects(client.load(),e=>e.code==='timeout');assert.equal(signal.aborted,true);fail=false;await client.load();
});
test('timeout includes response body reading',async()=>{
  const client=createDataClient({timeoutMs:10,fetchImpl:async()=>({ok:true,headers:new Headers({'Content-Type':'application/json'}),json:()=>new Promise(()=>{})})});
  await assert.rejects(client.load(),e=>e.code==='timeout');
});
test('development snapshot fetches only two public files and keeps original bytes',async()=>{
  const f=fixture();const calls=[];
  const documents=await publicSnapshot(async url=>{calls.push(url);return json(url.endsWith('/manifest.json')?f.manifest:f.summary)}, {includeSystem:false});
  assert.equal(documents.size,2);assert.equal(calls.length,2);assert.deepEqual(JSON.parse(documents.get('/data/ercot/manifest.json')),f.manifest);
});
test('preview serves page/data but excludes tooling and other data reports',async()=>{
  const f=fixture();const documents=new Map([['/data/ercot/manifest.json',JSON.stringify(f.manifest)],[`/data/ercot/generations/${f.manifest.generation}/summary.json`,JSON.stringify(f.summary)]]);
  const server=createPreviewServer(documents);await new Promise(resolve=>server.listen(0,'localhost',resolve));
  try{
    const base=`http://localhost:${server.address().port}`;
    for(const url of ['/projects/ercot/','/js/ercot-data.js','/data/ercot/manifest.json'])assert.equal((await fetch(base+url)).status,200);
    for(const url of ['/.git/config','/server.js','/tests/ercot-data.test.mjs','/node_modules/express/index.js',`/data/ercot/generations/${f.manifest.generation}/daily/system.json`])assert.equal((await fetch(base+url)).status,404);
  } finally {await new Promise(resolve=>server.close(resolve))}
});

