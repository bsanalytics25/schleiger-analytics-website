import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_MANIFEST, REQUIRED_FILES, parseManifest, normalizeZoneReport, normalizeSummary, createDataClient } from '../js/ercot-data.js';
import { monthlyZoneView, zoneMonthPeriods, dailyZoneView, zoneDailyBounds, zonePeakRows, sortZonePeaks, peakTiming, monthlyZoneConfig, dailyZoneConfig, zonePeaksConfig } from '../js/ercot-zone-model.js';
import { periodStatus } from '../js/ercot-chart-model.js';
import { publicSnapshot, createPreviewServer } from '../scripts/serve-ercot-preview.mjs';

// Synthetic schema fixtures, confined to tests. No production values are embedded.
function fixture() {
 const generation='a'.repeat(64);
 const metadata={schema_version:'1.0.0',generated_at:'2026-01-05T00:00:00Z',reporting_range:{start:'2026-01-01',end_exclusive:'2026-01-04'},dataset_coverage:{first:'2026-01-01',last:'2026-01-03',observation_count:216},selected_zones:['COAST','EAST','ERCOT'],units:{demand:'MW',energy:'MWh',contribution_fraction:'1',contribution_percent:'%'},quality:'complete',timezone:'America/Chicago',decimal_encoding:'string'};
 const manifest={generation,metadata,files:Object.fromEntries(REQUIRED_FILES.map(name=>[name,{path:`generations/${generation}/${name}`,sha256:'b'.repeat(64),bytes:1}]))};
 const envelope=rows=>({metadata:structuredClone(metadata),rows});
 const dailyRow=(zone,date)=>({zone_code:zone,reporting_date:date,observation_count:24,expected_observation_count:24,average_demand_mw:'10.123456789',peak_demand_mw:'20.123456789',minimum_demand_mw:'5.123456789',energy_mwh:'242.962962936'});
 const monthlyRow=zone=>({zone_code:zone,reporting_month:'2026-01-01',observation_count:72,expected_observation_count:72,average_demand_mw:'10.123456789',peak_demand_mw:'20.123456789',energy_mwh:'728.888888808'});
 const peak=(zone,date,demand)=>({zone_code:zone,demand_mw:demand,reporting_date:date,hour_ending_local:`${date}T02:00:00`,hour_ending_raw:`${date} HE02`,occurrence:1});
 const coverage=zone=>({zone_code:zone,observation_count:72,expected_observation_count:72,distinct_hour_label_count:72,repeated_hour_observation_count:0,missing_observation_count:0,unexpected_observation_count:0,first_hour_ending_local:'2026-01-01T01:00:00',last_hour_ending_local:'2026-01-04T00:00:00'});
 const daily=envelope(['COAST','EAST'].flatMap(zone=>['2026-01-01','2026-01-02','2026-01-03'].map(date=>dailyRow(zone,date))));
 const monthly=envelope(['COAST','EAST'].map(monthlyRow));
 const summary={metadata:structuredClone(metadata),observation_count:216,system_peak:peak('ERCOT','2026-01-02','50'),zone_peaks:[peak('COAST','2026-01-01','20.123456789'),peak('EAST','2026-01-02','30')],coverage:metadata.selected_zones.map(coverage)};
 return {manifest,daily,monthly,summary,dailySystem:envelope(['2026-01-01','2026-01-02','2026-01-03'].map(date=>dailyRow('ERCOT',date))),monthlySystem:envelope([monthlyRow('ERCOT')])};
}
const normalized=(f,kind='daily')=>normalizeZoneReport(f[kind],parseManifest(f.manifest,PRODUCTION_MANIFEST),kind);
const normalizedSummary=f=>normalizeSummary(f.summary,parseManifest(f.manifest,PRODUCTION_MANIFEST));
const invalid=e=>e.code==='invalid';
const filterError=e=>e.code==='filter';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fetchFixture(f,calls){return async url=>{calls.push(url);return json(url.endsWith('/manifest.json')?f.manifest:url.endsWith('/summary.json')?f.summary:url.endsWith('/daily/system.json')?f.dailySystem:url.endsWith('/monthly/system.json')?f.monthlySystem:url.endsWith('/daily/zones.json')?f.daily:f.monthly)}}

test('zone normalization permits same date across zones and preserves exact decimals and selection',()=>{
 const report=normalized(fixture());assert.equal(report.rows.length,6);assert.deepEqual(report.zoneCodes,['COAST','EAST']);assert.equal(report.rows[0].exact.average_demand_mw,'10.123456789');assert.ok(Object.isFrozen(report.rows[0]));
});
for(const kind of ['daily','monthly']) {
 for(const [label,edit] of [['null value',row=>row.average_demand_mw=null],['numeric decimal',row=>row.energy_mwh=1],['negative metric',row=>row.energy_mwh='-1'],['infinite metric',row=>row.peak_demand_mw='9'.repeat(400)],['system series',row=>row.zone_code='ERCOT'],['unselected zone',row=>row.zone_code='FWEST'],['unknown zone',row=>row.zone_code='UNKNOWN'],['invalid count',row=>row.observation_count=-1],['missing field',row=>delete row.expected_observation_count],['zero expected',row=>row.expected_observation_count=0]])test(`${kind} zones reject ${label}`,()=>{const f=fixture();edit(f[kind].rows[0]);assert.throws(()=>normalized(f,kind),invalid)});
 test(`${kind} zones reject duplicate zone-period keys`,()=>{const f=fixture();f[kind].rows.push(structuredClone(f[kind].rows[0]));assert.throws(()=>normalized(f,kind),invalid)});
 test(`${kind} zones reject mismatched metadata`,()=>{const f=fixture();f[kind].metadata.generated_at='2026-01-06T00:00:00Z';assert.throws(()=>normalized(f,kind),invalid)});
 test(`${kind} zones allow selected series with no observations, without inventing values`,()=>{const f=fixture();f[kind].rows=f[kind].rows.filter(row=>row.zone_code==='EAST');const report=normalized(f,kind);assert.deepEqual(report.zoneCodes,['COAST','EAST']);if(kind==='monthly')assert.equal(monthlyZoneView(report,'2026-01-01','energy_mwh').rows[0].missing,true);else assert.equal(zoneDailyBounds(report,['COAST']),null)});
}
test('monthly has no minimum metric and explicitly rejects unsupported fields',()=>{const f=fixture();assert.equal(normalized(f,'monthly').rows[0].minimum_demand_mw,undefined);f.monthly.rows[0].minimum_demand_mw='1';assert.throws(()=>normalized(f,'monthly'),invalid);assert.throws(()=>monthlyZoneView(normalized(fixture(),'monthly'),'2026-01-01','minimum_demand_mw'),filterError)});
test('monthly comparisons expose only selected zones, metric, period and units',()=>{
 const report=normalized(fixture(),'monthly');assert.deepEqual(zoneMonthPeriods(report),['2026-01-01']);
 for(const [metric,unit] of [['average_demand_mw','MW'],['peak_demand_mw','MW'],['energy_mwh','MWh']]){const view=monthlyZoneView(report,'2026-01-01',metric);assert.equal(view.specification.unit,unit);const config=monthlyZoneConfig(report,view);assert.equal(config.options.indexAxis,'y');assert.deepEqual(config.data.labels,['COAST','EAST']);assert.equal(config.data.datasets[0].data[0],view.rows[0][metric]);const cb=config.options.plugins.tooltip.callbacks;assert.match(cb.title([{dataIndex:0}]),/2026-01.*Coast.*COAST/);assert.match(cb.label({parsed:{x:10}}),new RegExp(unit));assert.match(cb.footer([{dataIndex:0}]),/Partial calendar month/);}
 assert.throws(()=>monthlyZoneView(report,'2026-02-01','energy_mwh'),filterError);
});
test('entirely absent months remain selectable within published bounds and stay null',()=>{const f=fixture();for(const doc of [f.manifest,f.monthly])doc.metadata.reporting_range.end_exclusive='2026-03-01';const report=normalized(f,'monthly');const view=monthlyZoneView(report,'2026-02-01','energy_mwh');assert.ok(view.rows.every(row=>row.missing));assert.deepEqual(monthlyZoneConfig(report,view).data.datasets[0].data,[null,null]);});
test('daily union coverage keeps asymmetric gaps and supports one or two zones',()=>{
 const f=fixture();f.daily.rows=f.daily.rows.filter(row=>!(row.zone_code==='COAST'&&row.reporting_date==='2026-01-03')&&!(row.zone_code==='EAST'&&row.reporting_date==='2026-01-01'));
 const report=normalized(f);assert.deepEqual(zoneDailyBounds(report,['COAST']),{start:'2026-01-01',end:'2026-01-02'});const view=dailyZoneView(report,['COAST','EAST'],'2026-01-01','2026-01-03');assert.equal(view.series[0].rows[2].missing,true);assert.equal(view.series[1].rows[0].missing,true);const config=dailyZoneConfig(report,view);assert.equal(config.data.datasets.length,4);assert.equal(config.options.scales.x.ticks.maxTicksLimit,4);assert.equal(config.data.datasets[0].data[2],null);assert.equal(config.data.datasets[2].data[0],null);assert.ok(config.data.datasets.every(dataset=>dataset.spanGaps===false));assert.equal(dailyZoneConfig(report,dailyZoneView(report,['COAST'],'2026-01-01','2026-01-02')).data.datasets.length,2);
});
for(const zones of [[],['COAST','COAST'],['ERCOT'],['UNKNOWN'],['COAST','EAST','WEST']])test(`invalid daily selection ${zones}`,()=>assert.throws(()=>zoneDailyBounds(normalized(fixture()),zones),filterError));
for(const [start,end] of [['',''],['2026-01-03','2026-01-01'],['2025-12-31','2026-01-02'],['2026-01-02','2026-01-04']])test(`invalid daily-zone dates ${start} ${end}`,()=>assert.throws(()=>dailyZoneView(normalized(fixture()),['COAST'],start,end),filterError));
test('daily count mismatches are retained and marked, including per-zone tooltip context',()=>{const f=fixture();f.daily.rows[0].observation_count=23;const report=normalized(f);const view=dailyZoneView(report,['COAST','EAST'],'2026-01-01','2026-01-01');const config=dailyZoneConfig(report,view);assert.equal(config.data.datasets[0].pointStyle[0],'triangle');assert.match(config.options.plugins.tooltip.callbacks.footer([{dataIndex:0}]),/COAST: 23 \/ 24/);assert.match(config.options.plugins.tooltip.callbacks.footer([{dataIndex:0}]),/EAST: 24 \/ 24/);assert.match(periodStatus(view.series[0].rows[0],report),/Incomplete/)});
test('empty daily selection yields no invented dates or zero demand',()=>{const f=fixture();f.daily.rows=[];const view=dailyZoneView(normalized(f),['COAST'],'','');assert.deepEqual(view.dates,[]);assert.deepEqual(view.series[0].rows,[])});
test('zero demand is valid, while zero observations suppress metric values',()=>{const f=fixture();Object.assign(f.daily.rows[0],{minimum_demand_mw:'0',average_demand_mw:'0',peak_demand_mw:'0',energy_mwh:'0'});assert.equal(normalized(f).rows[0].peak_demand_mw,0);f.daily.rows[0].observation_count=0;assert.equal(normalized(f).rows[0].peak_demand_mw,null)});
test('peak sorting is numeric, stable, reversible, non-mutating and keeps missing sort values last',()=>{
 const rows=[{zoneCode:'EAST',demandMW:20,hourEndingLocal:'2026-01-02T02:00:00',occurrence:1},{zoneCode:'COAST',demandMW:3,hourEndingLocal:'2026-01-01T02:00:00',occurrence:1},{zoneCode:'WEST',demandMW:null,hourEndingLocal:null,occurrence:null}];
 assert.deepEqual(sortZonePeaks(rows,'demand','ascending').map(row=>row.zoneCode),['COAST','EAST','WEST']);assert.deepEqual(sortZonePeaks(rows).map(row=>row.zoneCode),['EAST','COAST','WEST']);assert.deepEqual(sortZonePeaks(rows,'timing','descending').map(row=>row.zoneCode),['EAST','COAST','WEST']);assert.equal(rows[0].zoneCode,'EAST');assert.throws(()=>sortZonePeaks(rows,'total'),filterError);
});
test('zone peaks reuse summary without an ERCOT or total bar and preserve local timing',()=>{
 const summary=normalizedSummary(fixture());const rows=zonePeakRows(summary);const config=zonePeaksConfig(summary,rows);assert.deepEqual(config.data.labels,['COAST','EAST']);assert.deepEqual(config.data.datasets[0].data,[20.123456789,30]);assert.match(peakTiming(rows[0]),/Reporting date 2026-01-01; hour ending 2026-01-01 02:00:00 America\/Chicago; occurrence 1/);assert.match(config.options.plugins.tooltip.callbacks.footer([{dataIndex:0}]),/2026-01-01 through 2026-01-03/);
});
test('peak midnight and repeated occurrence are not converted to UTC or lost during sorting',()=>{
 const row={zoneCode:'COAST',demandMW:3,reportingDate:'2026-01-01',hourEndingLocal:'2026-01-02T00:00:00',occurrence:2};assert.match(peakTiming(row),/Reporting date 2026-01-01; hour ending 2026-01-02 00:00:00/);assert.equal(sortZonePeaks([row,{...row,zoneCode:'EAST',occurrence:1}],'timing','ascending')[0].occurrence,1);
});
test('absent zone peaks are retained as null for selected zones',()=>{const summary=normalizedSummary(fixture());const altered={...summary,zonePeaks:summary.zonePeaks.filter(row=>row.zoneCode==='EAST')};assert.equal(zonePeakRows(altered)[0].demandMW,null)});
test('zone requests share generation/cache and a failed lazy request retries only itself',async()=>{
 const f=fixture();const calls=[];let failed=false;const fetchBase=fetchFixture(f,calls);const client=createDataClient({fetchImpl:async(url,opts)=>{if(url.endsWith('/daily/zones.json')&&!failed){failed=true;calls.push(url);return new Response('',{status:503})}return fetchBase(url,opts)}});
 const [summary,monthly]=await Promise.all([client.load(),client.loadReport('monthly/zones.json')]);assert.equal(calls.length,3);assert.ok(calls.every(url=>!url.endsWith('/daily/zones.json')));f.manifest.generation='c'.repeat(64);await assert.rejects(client.loadReport('daily/zones.json'),e=>e.code==='http');await client.loadReport('daily/zones.json');assert.strictEqual(await client.load(),summary);assert.strictEqual(await client.loadReport('monthly/zones.json'),monthly);assert.equal(calls.length,5);assert.equal(calls.filter(url=>url.endsWith('/manifest.json')).length,1);assert.ok(calls.filter(url=>!url.endsWith('/manifest.json')).every(url=>url.includes('/'+'a'.repeat(64)+'/')));
});
test('local preview downloads daily zones only on first request and pins the old generation',async()=>{
 const f=fixture();const calls=[];const documents=await publicSnapshot(fetchFixture(f,calls));assert.equal(calls.length,5);assert.equal(documents.size,5);assert.ok(calls.every(url=>!url.endsWith('/daily/zones.json')));
 const server=createPreviewServer(documents);await new Promise(resolve=>server.listen(0,'localhost',resolve));
 try{const base=`http://localhost:${server.address().port}`;await fetch(base+'/projects/ercot/');assert.equal(calls.length,5);const url=base+'/data/ercot/'+f.manifest.files['daily/zones.json'].path;f.manifest.generation='c'.repeat(64);const responses=await Promise.all([fetch(url),fetch(url)]);assert.ok(responses.every(r=>r.status===200));assert.equal(calls.length,6);assert.ok(calls.at(-1).includes('/'+'a'.repeat(64)+'/'));assert.equal((await fetch(base+'/data/ercot/'+f.manifest.files['peaks/zones.json'].path)).status,404);}finally{await new Promise(resolve=>server.close(resolve))}
});
test('local lazy snapshot failures can retry without re-fetching successful reports',async()=>{
 const f=fixture();const calls=[];const fetchBase=fetchFixture(f,calls);let failed=false;
 const documents=await publicSnapshot(async(url,opts)=>{if(url.endsWith('/daily/zones.json')&&!failed){failed=true;calls.push(url);return new Response('',{status:503})}return fetchBase(url,opts)});
 const server=createPreviewServer(documents);await new Promise(resolve=>server.listen(0,'localhost',resolve));
 try{const url=`http://localhost:${server.address().port}/data/ercot/${f.manifest.files['daily/zones.json'].path}`;assert.equal((await fetch(url)).status,503);assert.equal((await fetch(url)).status,200);assert.equal(calls.length,7);assert.equal(calls.filter(url=>url.endsWith('/manifest.json')).length,1);}finally{await new Promise(resolve=>server.close(resolve))}
});

