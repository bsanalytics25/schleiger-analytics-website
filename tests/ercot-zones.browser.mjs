// Optional Playwright checks against the existing real-snapshot preview.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ERCOT_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ERCOT_PREVIEW_URL||'http://localhost:3000';
const manifest=await(await fetch(base+'/data/ercot/manifest.json')).json();
const names=['summary.json','daily/system.json','monthly/system.json','monthly/zones.json','daily/zones.json'];
const paths=Object.fromEntries(names.map(name=>[name,'/data/ercot/'+manifest.files[name].path]));
const raw={};
for(const name of names.filter(name=>name!=='daily/zones.json'))raw[name]=await(await fetch(base+paths[name])).json();
const zones=manifest.metadata.selected_zones.filter(zone=>zone!=='ERCOT');
const browser=await chromium.launch({headless:true,channel:process.env.ERCOT_BROWSER_CHANNEL||'msedge'});
let groups=0;
const pass=message=>{groups++;console.log(`PASS: ${message}`)};
try{
 const ctx=await browser.newContext({timezoneId:'America/Los_Angeles'});const page=await ctx.newPage();const errors=[],requests=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/data/'))requests.push(u.pathname);if(u.origin!==base)external.push(u.href)});
 for(const width of [1440,1024,961,960,768,760,390,320]){
  const count=requests.length;
  await page.setViewportSize({width,height:1000});await page.goto(base+'/projects/ercot/');
  for(const kind of ['monthly','peaks'])await page.locator(`#ercot-zone-${kind}-panel .ercot-badge`).filter({hasText:'Chart loaded'}).waitFor();
  await page.locator('#ercot-daily-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();
  await page.locator('#ercot-monthly-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();
  assert.equal(requests.length-count,5);assert.equal(requests.slice(count).filter(path=>path===paths['daily/zones.json']).length,0);assert.equal(requests.slice(count).filter(path=>path.endsWith('/summary.json')).length,1);
  assert.equal(await page.evaluate(()=>Chart.getChart('ercot-zone-monthly-chart').data.labels.length),zones.length);
  assert.equal(await page.evaluate(()=>Chart.getChart('ercot-zone-peaks-chart').options.indexAxis),'y');
  const activate=page.locator('#ercot-zone-daily-explorer > summary');await activate.focus();await page.keyboard.press('Enter');
  await page.locator('#ercot-zone-daily-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();
  assert.equal(await page.evaluate(()=>Chart.getChart('ercot-zone-daily-chart').data.datasets.length),2);
  assert.equal(requests.length-count,6);
  if(!raw['daily/zones.json'])raw['daily/zones.json']=await(await fetch(base+paths['daily/zones.json'])).json();
  const primary=await page.locator('#ercot-zone-daily-primary').inputValue();
  assert.equal(await page.locator(`#ercot-zone-daily-compare option[value="${primary}"]`).evaluate(option=>option.disabled),true);
  const compare=zones.find(zone=>zone!==primary);await page.locator('#ercot-zone-daily-compare').selectOption(compare);
  await page.waitForFunction(()=>Chart.getChart('ercot-zone-daily-chart').data.datasets.length===4);
  const dates=raw['daily/zones.json'].rows.filter(row=>row.zone_code===primary).map(row=>row.reporting_date).sort();
  await page.locator('#ercot-zone-daily-start').fill(dates[0]);await page.locator('#ercot-zone-daily-end').fill(dates[6]);await page.getByRole('button',{name:'Apply zone dates'}).click();
  await page.waitForFunction(()=>Chart.getChart('ercot-zone-daily-chart').data.labels.length===7);
  await page.locator('#ercot-zone-daily-panel details summary').click();assert.equal(await page.locator('#ercot-zone-daily-panel tbody tr').count(),14);
  await activate.click();await activate.click();assert.equal(requests.length-count,6);
  await page.locator('#ercot-zone-monthly-panel details summary').click();
  const periods=[...new Set(raw['monthly/zones.json'].rows.map(row=>row.reporting_month))].sort();await page.locator('#ercot-zone-monthly-period').selectOption(periods[0]);
  for(const metric of ['average_demand_mw','peak_demand_mw','energy_mwh']){
   await page.locator('#ercot-zone-monthly-metric').selectOption(metric);
   const values=await page.evaluate(()=>Chart.getChart('ercot-zone-monthly-chart').data.datasets[0].data);
   assert.deepEqual(values,zones.map(zone=>Number(raw['monthly/zones.json'].rows.find(row=>row.zone_code===zone&&row.reporting_month===periods[0])[metric])));
  }
  assert.equal(await page.locator('#ercot-zone-monthly-panel tbody tr').count(),zones.length);
  const sort=page.getByRole('button',{name:'Sort by zone',exact:true});await sort.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#ercot-zone-peaks-panel [data-sort-key="zone"]').getAttribute('aria-sort')==='ascending');
  const sorted=await page.locator('#ercot-zone-peaks-panel tbody th').allTextContents();assert.ok(sorted[0].includes('COAST'));
  await page.getByRole('button',{name:'Sort by peak demand',exact:true}).click();assert.equal(await page.locator('#ercot-zone-peaks-panel [data-sort-key="demand"]').getAttribute('aria-sort'),'descending');
  const values=await page.evaluate(()=>Chart.getChart('ercot-zone-peaks-chart').data.datasets[0].data);assert.deepEqual(values,[...raw['summary.json'].zone_peaks].map(row=>Number(row.demand_mw)).sort((a,b)=>b-a));
  await page.getByRole('button',{name:'Sort by peak timing',exact:true}).click();assert.equal(await page.locator('#ercot-zone-peaks-panel [data-sort-key="timing"]').getAttribute('aria-sort'),'ascending');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  if(process.env.ERCOT_SCREENSHOT_DIR&&[1440,390].includes(width)){await mkdir(process.env.ERCOT_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${process.env.ERCOT_SCREENSHOT_DIR}/ercot-phase4-${width}.png`,fullPage:true});}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(requests.length,48);assert.ok(requests.every(path=>path.endsWith('/manifest.json')||Object.values(paths).includes(path)));
 pass('eight widths (320–1440), five eager/one lazy requests, keyboard activation/sorting, one/two-zone daily filters, all monthly metrics, tables, no overflow/console errors/runtime CDN');
 await page.setViewportSize({width:1440,height:1000});await page.locator('#ercot-zone-monthly-chart').scrollIntoViewIfNeeded();
 const point=await page.evaluate(()=>{const chart=Chart.getChart('ercot-zone-monthly-chart');const p=chart.getDatasetMeta(0).data[0].getCenterPoint();const b=chart.canvas.getBoundingClientRect();return{x:p.x+b.x,y:p.y+b.y}});
 await page.mouse.move(point.x,point.y);await page.waitForFunction(()=>Chart.getChart('ercot-zone-monthly-chart').tooltip.dataPoints?.length>0);
 const tooltip=await page.evaluate(()=>{const t=Chart.getChart('ercot-zone-monthly-chart').tooltip;return{title:t.title,body:t.body.map(row=>row.lines)}});assert.match(tooltip.title.join(' '),/2026-01.*COAST/);assert.match(tooltip.body.flat().join(' '),/MWh/);
 const old=await page.evaluate(()=>Chart.getChart('ercot-zone-daily-chart').data.labels);
 await page.locator('#ercot-zone-daily-start').fill(old.at(-1));await page.locator('#ercot-zone-daily-end').fill(old[0]);await page.getByRole('button',{name:'Apply zone dates'}).click();assert.equal(await page.locator('#ercot-zone-daily-filter-error').isVisible(),true);assert.deepEqual(await page.evaluate(()=>Chart.getChart('ercot-zone-daily-chart').data.labels),old);
 pass('actual pointer tooltips include period/zone/metric/unit, invalid daily filters preserve the last valid chart');await ctx.close();

 for(const scenario of ['monthly-network','monthly-invalid','daily-network','daily-malformed','gaps-incomplete','empty-daily','missing-month-zone','summary-retry','library-failure','canvas-failure']){
  const context=await browser.newContext();const p=await context.newPage();const jsErrors=[];p.on('pageerror',e=>jsErrors.push(e.message));
  const counts={manifest:0};for(const name of names)counts[name]=0;
  const docs=structuredClone(raw);let libraryAvailable=false;
  if(scenario==='library-failure')await p.route('**/vendor/chart-4.6.1.umd.min.js',route=>libraryAvailable?route.continue():route.abort());
  if(scenario==='canvas-failure')await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){return this.id==='ercot-zone-peaks-chart'?null:original.apply(this,args)};window.restoreCanvas=()=>HTMLCanvasElement.prototype.getContext=original});
  const primary=zones[0];
  if(scenario==='gaps-incomplete'){
   const rows=docs['daily/zones.json'].rows;const dates=rows.filter(row=>row.zone_code===primary).map(row=>row.reporting_date).sort();docs['daily/zones.json'].rows=rows.filter(row=>!(row.zone_code===primary&&row.reporting_date===dates[2]));docs['daily/zones.json'].rows.find(row=>row.zone_code===primary).observation_count--;
  }
  if(scenario==='empty-daily')docs['daily/zones.json'].rows=[];
  if(scenario==='missing-month-zone'){
   const latest=docs['monthly/zones.json'].rows.map(row=>row.reporting_month).sort().at(-1);
   docs['monthly/zones.json'].rows=docs['monthly/zones.json'].rows.filter(row=>!(row.zone_code===primary&&row.reporting_month===latest));
   docs['monthly/zones.json'].rows.find(row=>row.reporting_month===latest).observation_count--;
  }
  await p.route('**/data/ercot/**',async route=>{
   const path=new URL(route.request().url()).pathname;if(path.endsWith('/manifest.json')){counts.manifest++;return route.fulfill({contentType:'application/json',body:JSON.stringify(manifest)})}
   const name=names.find(name=>paths[name]===path);assert.ok(name,'unexpected data path');counts[name]++;
   if(((scenario==='monthly-network'&&name==='monthly/zones.json')||(scenario==='daily-network'&&name==='daily/zones.json')||(scenario==='summary-retry'&&name==='summary.json'))&&counts[name]===1)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
   if(scenario==='daily-malformed'&&name==='daily/zones.json'&&counts[name]===1)return route.fulfill({contentType:'application/json',body:'{bad'});
   const doc=structuredClone(docs[name]);if(scenario==='monthly-invalid'&&name==='monthly/zones.json'&&counts[name]===1)doc.rows[0].average_demand_mw=null;
   return route.fulfill({contentType:'application/json',body:JSON.stringify(doc)});
  });
  await p.goto(base+'/projects/ercot/');
  assert.equal(counts['daily/zones.json'],0);
  if(scenario.startsWith('daily-')||['gaps-incomplete','empty-daily'].includes(scenario)){
   await p.locator('#ercot-zone-monthly-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();const id=await p.evaluate(()=>Chart.getChart('ercot-zone-monthly-chart').id);
   await p.locator('#ercot-zone-daily-explorer > summary').click();
   if(scenario.startsWith('daily-')){await p.getByRole('button',{name:'Retry daily zone chart',exact:true}).waitFor();await p.getByRole('button',{name:'Retry daily zone chart',exact:true}).click();}
   if(scenario==='empty-daily'){
    await p.locator('#ercot-zone-daily-panel .ercot-badge').filter({hasText:'No observations'}).waitFor();assert.equal(await p.locator('#ercot-zone-daily-chart').isVisible(),false);assert.equal(await p.locator('#ercot-zone-daily-start').isDisabled(),true);assert.equal(await p.locator('#ercot-zone-daily-primary').isEnabled(),true);assert.match(await p.locator('#ercot-zone-daily-status').textContent(),/not zero/);
   }else{
    await p.locator('#ercot-zone-daily-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();if(scenario==='gaps-incomplete'){const state=await p.evaluate(()=>Chart.getChart('ercot-zone-daily-chart').data.datasets[0]);assert.equal(state.data[2],null);assert.equal(state.spanGaps,false);assert.equal(state.pointStyle[0],'triangle');assert.match(await p.locator('#ercot-zone-daily-status').textContent(),/1 zone-days without observations, 1 with count mismatches/);}
   }
   assert.equal(await p.evaluate(()=>Chart.getChart('ercot-zone-monthly-chart').id),id);assert.equal(counts['monthly/zones.json'],1);assert.equal(counts['daily/zones.json'],scenario.startsWith('daily-')?2:1);
  }else if(scenario.startsWith('monthly-')){
   await p.getByRole('button',{name:'Retry monthly zone chart',exact:true}).waitFor();await p.locator('#ercot-zone-peaks-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();const id=await p.evaluate(()=>Chart.getChart('ercot-zone-peaks-chart').id);await p.getByRole('button',{name:'Retry monthly zone chart',exact:true}).click();await p.locator('#ercot-zone-monthly-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();assert.equal(await p.evaluate(()=>Chart.getChart('ercot-zone-peaks-chart').id),id);assert.equal(counts['monthly/zones.json'],2);assert.equal(counts['summary.json'],1);assert.equal(await p.locator(':focus').getAttribute('id'),'ercot-zone-monthly-status');
  }else if(scenario==='missing-month-zone'){
   await p.locator('#ercot-zone-monthly-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();assert.equal(await p.evaluate(()=>Chart.getChart('ercot-zone-monthly-chart').data.datasets[0].data[0]),null);assert.match(await p.locator('#ercot-zone-monthly-status').textContent(),/1 without observations, 1 with count mismatches/);assert.match(await p.locator('#ercot-zone-monthly-panel tbody tr').first().textContent(),/Unavailable/);
  }else if(scenario==='summary-retry'){
   await p.getByRole('button',{name:'Retry zone peaks',exact:true}).waitFor();await p.getByRole('button',{name:'Retry zone peaks',exact:true}).click();await p.locator('#ercot-zone-peaks-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();await p.getByRole('button',{name:'Retry loading summary',exact:true}).click();await p.locator('#ercot-status-badge').filter({hasText:'Summary loaded'}).waitFor();assert.equal(counts['summary.json'],2);
  }else if(scenario==='library-failure'){
   await p.getByRole('button',{name:'Retry monthly zone chart',exact:true}).waitFor();await p.getByRole('button',{name:'Retry zone peaks',exact:true}).waitFor();assert.equal(await p.locator('#ercot-zone-monthly-panel tbody tr').count(),zones.length);libraryAvailable=true;await p.getByRole('button',{name:'Retry monthly zone chart',exact:true}).click();await p.locator('#ercot-zone-monthly-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();await p.getByRole('button',{name:'Retry zone peaks',exact:true}).click();await p.locator('#ercot-zone-peaks-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();assert.equal(counts['monthly/zones.json'],1);assert.equal(counts['summary.json'],1);
  }else if(scenario==='canvas-failure'){
   await p.getByRole('button',{name:'Retry zone peaks',exact:true}).waitFor();assert.equal(await p.locator('#ercot-zone-peaks-panel tbody tr').count(),zones.length);await p.evaluate(()=>window.restoreCanvas());await p.getByRole('button',{name:'Retry zone peaks',exact:true}).click();await p.locator('#ercot-zone-peaks-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();assert.equal(counts['summary.json'],1);
  }
  assert.equal(counts.manifest,1);assert.deepEqual(jsErrors,[]);pass(`zone browser state/recovery: ${scenario}`);await context.close();
 }
 console.log(`${groups} zone browser check groups passed.`);
}finally{await browser.close()}

