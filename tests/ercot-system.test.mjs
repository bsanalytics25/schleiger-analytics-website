import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRODUCTION_MANIFEST, REQUIRED_FILES, parseManifest, normalizeSystemReport, createDataClient } from '../js/ercot-data.js';
import { chartConfig, dailyBounds, filterDaily, monthlyRows, monthlyMetric, periodStatus, formatValue } from '../js/ercot-chart-model.js';
import { publicSnapshot, createPreviewServer } from '../scripts/serve-ercot-preview.mjs';

// Synthetic aggregate-contract fixtures; never imported by the production page.
function fixture() {
  const metadata = {schema_version:'1.0.0',generated_at:'2026-04-01T00:00:00Z',reporting_range:{start:'2026-01-02',end_exclusive:'2026-03-01'},dataset_coverage:{first:'2026-01-02',last:'2026-02-28',observation_count:1000},selected_zones:['ERCOT'],units:{demand:'MW',energy:'MWh',contribution_fraction:'1',contribution_percent:'%'},quality:'incomplete',timezone:'America/Chicago',decimal_encoding:'string'};
  const generation='a'.repeat(64);
  const manifest={generation,metadata,files:Object.fromEntries(REQUIRED_FILES.map(name=>[name,{path:`generations/${generation}/${name}`,bytes:1,sha256:'b'.repeat(64)}]))};
  const row=date=>({zone_code:'ERCOT',reporting_date:date,observation_count:24,expected_observation_count:24,average_demand_mw:'2.123456789',minimum_demand_mw:'1.000000',peak_demand_mw:'3.000000',energy_mwh:'50.962962936'});
  const daily={metadata:structuredClone(metadata),rows:[row('2026-01-02'),row('2026-01-04')]};
  const monthly={metadata:structuredClone(metadata),rows:[{zone_code:'ERCOT',reporting_month:'2026-01-01',observation_count:48,expected_observation_count:720,average_demand_mw:'2.123456789',peak_demand_mw:'3.000000',energy_mwh:'101.925925872'}]};
  return {manifest,daily,monthly};
}
function normalize(f,kind='daily'){return normalizeSystemReport(f[kind],parseManifest(f.manifest,PRODUCTION_MANIFEST),kind)}
const invalid = error=>error.code==='invalid';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('daily normalization preserves decimals, sorts dates and confirms optional minimum exists',()=>{
 const f=fixture();f.daily.rows.reverse();const report=normalize(f);
 assert.equal(report.rows[0].date,'2026-01-02');assert.equal(report.rows[0].average_demand_mw,2.123456789);assert.equal(report.rows[0].exact.average_demand_mw,'2.123456789');assert.equal(report.rows[0].minimum_demand_mw,1);assert.ok(Object.isFrozen(report.rows[0]));
});
for(const kind of ['daily','monthly']){
 for(const [name,edit] of [
  ['missing metric',r=>delete r.peak_demand_mw],['null metric',r=>r.energy_mwh=null],['numeric metric',r=>r.average_demand_mw=2],['negative decimal',r=>r.energy_mwh='-1'],['non-finite decimal',r=>r.energy_mwh='9'.repeat(400)],['exponential decimal',r=>r.energy_mwh='1e3'],['average above peak',r=>r.average_demand_mw='100'],['wrong zone',r=>r.zone_code='COAST'],['negative count',r=>r.observation_count=-1],['zero expected',r=>r.expected_observation_count=0],['unsafe count',r=>r.observation_count=Number.MAX_SAFE_INTEGER+1]
 ])test(`${kind} rejects ${name}`,()=>{const f=fixture();edit(f[kind].rows[0]);assert.throws(()=>normalize(f,kind),invalid)});
 test(`${kind} rejects duplicate dates`,()=>{const f=fixture();f[kind].rows.push(structuredClone(f[kind].rows[0]));assert.throws(()=>normalize(f,kind),invalid)});
 test(`${kind} rejects wrong captured metadata`,()=>{const f=fixture();f[kind].metadata.generated_at='2026-04-02T00:00:00Z';assert.throws(()=>normalize(f,kind),invalid)});
 test(`${kind} permits empty rows and never fabricates demand`,()=>{const f=fixture();f[kind].rows=[];const report=normalize(f,kind);assert.deepEqual(report.rows,[]);if(kind==='daily'){assert.equal(dailyBounds(report),null);assert.deepEqual(filterDaily(report,'',''),[])}else assert.ok(monthlyRows(report).every(row=>row.missing));});
 test(`${kind} zero observations produce null display metrics, not zero`,()=>{const f=fixture();f[kind].rows[0].observation_count=0;assert.equal(normalize(f,kind).rows[0].average_demand_mw,null)});
}
test('daily rejects impossible dates and dates outside reporting range',()=>{
 for(const date of ['2026-02-30','2026-01-01','2026-03-01']){const f=fixture();f.daily.rows[0].reporting_date=date;assert.throws(()=>normalize(f),invalid)}
});
test('daily rejects minimum above average',()=>{const f=fixture();f.daily.rows[0].minimum_demand_mw='3';assert.throws(()=>normalize(f),invalid)});
test('monthly allows first-of-month label before a partial reporting start',()=>{
 const f=fixture();const report=normalize(f,'monthly');assert.match(periodStatus(report.rows[0],report),/Partial calendar month/);
});
test('monthly rejects mid-month labels and months outside range',()=>{
 for(const date of ['2026-01-02','2025-12-01','2026-03-01']){const f=fixture();f.monthly.rows[0].reporting_month=date;assert.throws(()=>normalize(f,'monthly'),invalid)}
});
test('daily calendar inserts gaps and filters inclusively without mutating the report',()=>{
 const report=normalize(fixture());const rows=filterDaily(report,'2026-01-02','2026-01-04');assert.equal(rows.length,3);assert.equal(rows[1].date,'2026-01-03');assert.equal(rows[1].missing,true);assert.equal(rows[1].observed,null);assert.equal(report.rows.length,2);assert.equal(filterDaily(report,'2026-01-04','2026-01-04').length,1);
});
for(const [start,end] of [['',''],['2026-01-04','2026-01-02'],['2026-01-01','2026-01-04'],['2026-01-02','2026-01-05']])test(`daily rejects invalid filter ${start} / ${end}`,()=>assert.throws(()=>filterDaily(normalize(fixture()),start,end),error=>error.code==='filter'));
test('count mismatches, missing rows and matching-but-unaudited counts remain distinct',()=>{
 const f=fixture();f.daily.rows[0].observation_count=23;const report=normalize(f);assert.match(periodStatus(report.rows[0],report),/Incomplete observation counts/);assert.match(periodStatus(report.rows[1],report),/See dataset coverage audit/);assert.match(periodStatus({missing:true},report),/No observations/);
});
test('monthly inserts absent months and keeps metrics independent of daily filter',()=>{
 const f=fixture();const monthly=normalize(f,'monthly');const rows=monthlyRows(monthly);filterDaily(normalize(f),'2026-01-02','2026-01-02');assert.equal(rows.length,2);assert.equal(rows[1].missing,true);assert.equal(rows[0].energy_mwh,101.925925872);
 for(const [key,unit] of [['average_demand_mw','MW'],['peak_demand_mw','MW'],['energy_mwh','MWh']]){const config=chartConfig('monthly',monthly,rows,key);assert.equal(monthlyMetric(key).unit,unit);assert.equal(config.data.datasets[0].data[0],rows[0][key]);assert.match(config.options.scales.y.title.text,new RegExp(unit));}
 assert.throws(()=>monthlyMetric('__proto__'),error=>error.code==='filter');
});
test('daily config supports minimum, renders missing dates as null and never spans gaps',()=>{
 const report=normalize(fixture());const rows=filterDaily(report,'2026-01-02','2026-01-04');const config=chartConfig('daily',report,rows,undefined,true);assert.equal(config.type,'line');assert.equal(config.data.datasets.length,3);for(const dataset of config.data.datasets){assert.equal(dataset.data[1],null);assert.equal(dataset.spanGaps,false)}assert.equal(chartConfig('daily',report,rows).data.datasets.length,2);
});
test('tooltips retain actual reporting dates, units and observation counts',()=>{
 const f=fixture();f.daily.rows[0].observation_count=23;const report=normalize(f);const rows=filterDaily(report,'2026-01-02','2026-01-04');const config=chartConfig('daily',report,rows);const cb=config.options.plugins.tooltip.callbacks;
 assert.equal(cb.title([{dataIndex:0}]),'2026-01-02');assert.equal(cb.label({dataset:{label:'Average demand'},parsed:{y:2.123456789}}),'Average demand: 2.12 MW');assert.match(cb.footer([{dataIndex:0}]),/23 \/ 24/);assert.equal(config.data.datasets[0].pointStyle[0],'triangle');assert.equal(formatValue(null,'MW'),'Unavailable');assert.equal(formatValue(0,'MW'),'0 MW');
});
test('client shares manifest across independent system reports and retries only the failed report',async()=>{
 const f=fixture();let fail=true;const calls=[];
 const client=createDataClient({fetchImpl:async url=>{calls.push(url);if(url.endsWith('/manifest.json'))return json(f.manifest);if(url.endsWith('/monthly/system.json')&&fail){fail=false;return new Response('',{status:503})}return json(url.endsWith('/daily/system.json')?f.daily:f.monthly)}});
 const results=await Promise.allSettled([client.loadReport('daily/system.json'),client.loadReport('monthly/system.json')]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
 f.manifest.generation='c'.repeat(64);await client.loadReport('monthly/system.json');assert.strictEqual(await client.loadReport('daily/system.json'),results[0].value);assert.equal(calls.length,4);assert.equal(calls.filter(url=>url.endsWith('manifest.json')).length,1);assert.ok(calls.filter(url=>!url.endsWith('manifest.json')).every(url=>url.includes('/'+'a'.repeat(64)+'/')));
 await assert.rejects(client.loadReport('contributions/hourly.json'),invalid);
});
test('malformed system JSON is retryable without discarding another successful report',async()=>{
 const f=fixture();let failed=false;let dailyCalls=0;const client=createDataClient({fetchImpl:async url=>{if(url.endsWith('manifest.json'))return json(f.manifest);if(url.endsWith('/daily/system.json')){dailyCalls++;if(!failed){failed=true;return new Response('{bad',{headers:{'Content-Type':'application/json'}})}return json(f.daily)}return json(f.monthly)}});
 await client.loadReport('monthly/system.json');await assert.rejects(client.loadReport('daily/system.json'),e=>e.code==='json');await client.loadReport('daily/system.json');assert.equal(dailyCalls,2);
});
test('vendored library is the pinned production UMD and includes MIT license',async()=>{
 const bundle=await readFile(new URL('../js/vendor/chart-4.6.1.umd.min.js',import.meta.url),'utf8');assert.match(bundle.slice(0,200),/Chart\.js v4\.6\.1/);const license=await readFile(new URL('../js/vendor/Chart.js-LICENSE.md',import.meta.url),'utf8');assert.match(license,/The MIT License/);
});

