// Optional real-browser checks. Uses an already installed Playwright package;
// no browser package or browser binary is added to the website dependencies.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ERCOT_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.ERCOT_PREVIEW_URL || 'http://localhost:3000';
const manifest = await (await fetch(`${base}/data/ercot/manifest.json`)).json();
const paths = Object.fromEntries(['summary.json','daily/system.json','monthly/system.json','monthly/zones.json'].map(name=>[name,`/data/ercot/${manifest.files[name].path}`]));
const documents = {};
for (const [name,path] of Object.entries(paths)) documents[name] = await (await fetch(base+path)).json();
const browser = await chromium.launch({headless:true,channel:process.env.ERCOT_BROWSER_CHANNEL || 'msedge'});
const results = [];
function check(name) { results.push(name); console.log(`PASS: ${name}`); }
try {
 const context = await browser.newContext({timezoneId:'America/Los_Angeles'});
 const page = await context.newPage();
 const errors=[]; const dataRequests=[]; const external=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('request',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/data/'))dataRequests.push(url.pathname);if(url.origin!==base)external.push(url.href)});
 for(const width of [1440,1024,961,960,768,760,390,320]) {
  await page.setViewportSize({width,height:1000});
  await page.goto(`${base}/projects/ercot/`);
  await page.locator('#ercot-daily-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();
  await page.locator('#ercot-monthly-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();
  const state=await page.evaluate(()=>({version:Chart.version,daily:Chart.getChart('ercot-daily-chart').data.labels.length,monthly:Chart.getChart('ercot-monthly-chart').data.labels.length,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.equal(state.version,'4.6.1');assert.equal(state.daily,documents['daily/system.json'].rows.length);assert.equal(state.monthly,documents['monthly/system.json'].rows.length);assert.equal(state.width,state.scrollWidth);
  await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').textContent(),'Skip to dashboard');await page.keyboard.press('Enter');assert.equal(await page.locator(':focus').getAttribute('id'),'main-content');
  if(width<=960){await page.locator('.menu').click();assert.equal(await page.locator('.menu').getAttribute('aria-expanded'),'true');await page.locator('.menu').click();}
  await page.locator('#ercot-daily-panel details summary').click();await page.locator('#ercot-monthly-panel details summary').click();
  assert.equal(await page.locator('#ercot-daily-panel tbody tr').count(),documents['daily/system.json'].rows.length);
  assert.equal(await page.locator('canvas[role="img"][aria-describedby]').count(),5);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  if(process.env.ERCOT_SCREENSHOT_DIR && [1440,390].includes(width)){
   await mkdir(process.env.ERCOT_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${process.env.ERCOT_SCREENSHOT_DIR}/ercot-phase3-${width}.png`,fullPage:true});
  }
 }
 assert.equal(dataRequests.length,40);assert.ok(dataRequests.every(path=>path.endsWith('/manifest.json')||Object.values(paths).includes(path)));assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 check('real snapshot renders at eight desktop/mobile widths; accessible navigation/tables, no overflow, five same-generation data requests, daily zones deferred, no runtime CDN or console errors');
 const start=documents['daily/system.json'].rows[20].reporting_date;
 const end=documents['daily/system.json'].rows[30].reporting_date;
 await page.locator('#ercot-daily-start').fill(start);await page.locator('#ercot-daily-end').fill(end);await page.getByRole('button',{name:'Apply dates'}).click();
 await page.waitForFunction(()=>Chart.getChart('ercot-daily-chart').data.labels.length===11);
 await page.locator('#ercot-daily-minimum').check();await page.waitForFunction(()=>Chart.getChart('ercot-daily-chart').data.datasets.length===3);
 for(const metric of ['peak_demand_mw','energy_mwh','average_demand_mw']){
  await page.locator('#ercot-monthly-metric').selectOption(metric);
  const values=await page.evaluate(()=>Chart.getChart('ercot-monthly-chart').data.datasets[0].data);
  assert.deepEqual(values,documents['monthly/system.json'].rows.map(r=>Number(r[metric])));
 }
 assert.equal(await page.locator('#ercot-daily-panel tbody tr').count(),11);
 assert.equal(await page.locator('#ercot-monthly-panel tbody tr').count(),documents['monthly/system.json'].rows.length);
 await page.setViewportSize({width:1440,height:1000});await page.locator('#ercot-daily-chart').scrollIntoViewIfNeeded();
 const point=await page.evaluate(()=>{const chart=Chart.getChart('ercot-daily-chart');const p=chart.getDatasetMeta(0).data[5].getCenterPoint();const r=chart.canvas.getBoundingClientRect();return{x:r.x+p.x,y:r.y+p.y,label:chart.data.labels[5]}});
 await page.mouse.move(point.x,point.y);await page.waitForFunction(()=>Chart.getChart('ercot-daily-chart').tooltip.dataPoints?.length>0);
 assert.equal(await page.evaluate(()=>Chart.getChart('ercot-daily-chart').tooltip.dataPoints[0].label),point.label);
 const before=await page.evaluate(()=>Chart.getChart('ercot-daily-chart').data.labels);
 await page.locator('#ercot-daily-start').fill(end);await page.locator('#ercot-daily-end').fill(start);await page.getByRole('button',{name:'Apply dates'}).click();assert.equal(await page.locator('#ercot-daily-filter-error').isVisible(),true);
 assert.deepEqual(await page.evaluate(()=>Chart.getChart('ercot-daily-chart').data.labels),before);
 check('daily filter, optional minimum, all monthly metrics, real pointer tooltips and invalid-range handling; monthly/KPI scope independent');
 await context.close();

 for(const scenario of ['daily-network','daily-malformed','monthly-invalid','library-failure','canvas-failure','gaps-and-incomplete','empty']) {
  const ctx=await browser.newContext();const p=await ctx.newPage();const jsErrors=[];const counts={manifest:0,daily:0,monthly:0,summary:0,zones:0};
  p.on('pageerror',e=>jsErrors.push(e.message));
  if(scenario==='canvas-failure')await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){return this.id==='ercot-daily-chart'?null:original.apply(this,args)};window.restoreCanvas=()=>HTMLCanvasElement.prototype.getContext=original;});
  let libraryAvailable=false;
  if(scenario==='library-failure')await p.route('**/vendor/chart-4.6.1.umd.min.js',route=>{if(!libraryAvailable)return route.abort();return route.continue()});
  const raw=structuredClone(documents),m=structuredClone(manifest);
  if(scenario==='gaps-and-incomplete'){
   m.metadata.quality='incomplete';for(const report of Object.values(raw))report.metadata.quality='incomplete';
   const daily=raw['daily/system.json'];const removed=daily.rows.splice(2,1)[0];daily.rows[0].observation_count--;
   const summary=raw['summary.json'];const system=summary.coverage.find(r=>r.zone_code==='ERCOT');system.observation_count-=removed.observation_count+1;system.distinct_hour_label_count-=removed.observation_count+1;system.missing_observation_count+=removed.observation_count+1;summary.observation_count-=removed.observation_count+1;
  }
  if(scenario==='empty'){raw['daily/system.json'].rows=[];raw['monthly/system.json'].rows=[];}
  await p.route('**/data/ercot/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/manifest.json')){counts.manifest++;return route.fulfill({contentType:'application/json',body:JSON.stringify(m)})}
   const name=Object.keys(paths).find(name=>paths[name]===path);assert.ok(name,'unexpected report requested');
   const key=name.endsWith('/zones.json')?'zones':name.startsWith('daily')?'daily':name.startsWith('monthly')?'monthly':'summary';counts[key]++;
   if(scenario==='daily-network'&&key==='daily'&&counts[key]===1)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
   if(scenario==='daily-malformed'&&key==='daily'&&counts[key]===1)return route.fulfill({contentType:'application/json',body:'{bad'});
   const data=structuredClone(raw[name]);if(scenario==='monthly-invalid'&&key==='monthly'&&counts[key]===1)data.rows[0].energy_mwh=null;
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await p.goto(`${base}/projects/ercot/`);
  await p.locator('#ercot-status-badge').filter({hasText:scenario==='gaps-and-incomplete'?'Coverage warning':'Summary loaded'}).waitFor();
  if(['gaps-and-incomplete','empty'].includes(scenario)){
   await p.locator('#ercot-daily-panel[aria-busy="false"]').waitFor();await p.locator('#ercot-monthly-panel[aria-busy="false"]').waitFor();
   if(scenario==='empty'){assert.equal(await p.locator('#ercot-daily-panel canvas').isVisible(),false);assert.match(await p.locator('#ercot-daily-status').textContent(),/not zero/)}
   else{const points=await p.evaluate(()=>Chart.getChart('ercot-daily-chart').data.datasets[0]);assert.equal(points.data[2],null);assert.equal(points.spanGaps,false);assert.equal(points.pointStyle[0],'triangle');assert.match(await p.locator('#ercot-daily-status').textContent(),/1 with no observations, 1 with count mismatches/);}
  }else{
   const kind=scenario==='monthly-invalid'?'monthly':'daily';
   await p.locator(`#ercot-${kind}-panel .ercot-chart-retry`).waitFor();
   assert.equal(await p.locator('#ercot-peak-demand').textContent(),new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(raw['summary.json'].system_peak.demand_mw))+' MW');
   if(scenario==='library-failure'){
    assert.equal(await p.locator('#ercot-daily-panel tbody tr').count(),documents['daily/system.json'].rows.length);
    await p.getByRole('button',{name:'Retry monthly chart',exact:true}).waitFor();
    libraryAvailable=true;
    await p.getByRole('button',{name:'Retry daily chart',exact:true}).click();await p.locator('#ercot-daily-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();
    await p.getByRole('button',{name:'Retry monthly chart',exact:true}).click();await p.locator('#ercot-monthly-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();assert.equal(counts.daily,1);assert.equal(counts.monthly,1);
   }else{
    const other=kind==='daily'?'monthly':'daily';await p.locator(`#ercot-${other}-panel .ercot-badge`).filter({hasText:'Chart loaded'}).waitFor();const otherId=await p.evaluate(other=>Chart.getChart(`ercot-${other}-chart`).id,other);
    if(scenario==='canvas-failure')await p.evaluate(()=>window.restoreCanvas());
    await p.locator(`#ercot-${kind}-panel .ercot-chart-retry`).click();await p.locator(`#ercot-${kind}-panel .ercot-badge`).filter({hasText:'Chart loaded'}).waitFor();
    assert.equal(await p.evaluate(other=>Chart.getChart(`ercot-${other}-chart`).id,other),otherId);assert.equal(counts[other],1);assert.equal(counts[kind],scenario==='canvas-failure'?1:2);
    assert.equal(await p.locator(':focus').getAttribute('id'),`ercot-${kind}-status`);
   }
  }
  assert.equal(counts.manifest,1);assert.equal(counts.summary,1);assert.deepEqual(jsErrors,[]);check(`browser recovery/state: ${scenario}`);await ctx.close();
 }
 console.log(`${results.length} browser check groups passed.`);
} finally {await browser.close()}


