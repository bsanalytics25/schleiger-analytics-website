// Optional Playwright integration/accessibility checks using the existing preview.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ERCOT_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ERCOT_PREVIEW_URL||'http://localhost:3000';
const production='https://www.schleigeranalytics.com';
function luminance(rgb){return rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)}
function ratio(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
async function colors(page,selector,property='color'){
 return page.locator(selector).first().evaluate((element,property)=>{
  const rgb=value=>value.match(/[\d.]+/g).map(Number);
  let background=[255,255,255],current=element;
  while(current){const c=rgb(getComputedStyle(current).backgroundColor);if(c.length===3||c[3]===1){background=c;break}current=current.parentElement}
  return{foreground:rgb(getComputedStyle(element)[property]),background};
 },property);
}
async function ready(page){
 await page.locator('#ercot-status-badge').filter({hasText:'Summary loaded'}).waitFor();
 for(const id of ['ercot-daily','ercot-monthly','ercot-zone-monthly','ercot-zone-peaks'])await page.locator(`#${id}-panel .ercot-badge`).filter({hasText:'Chart loaded'}).waitFor();
}
const browser=await chromium.launch({headless:true,channel:process.env.ERCOT_BROWSER_CHANNEL||'msedge'});
let groups=0;const pass=message=>{groups++;console.log(`PASS: ${message}`)};
try{
 const context=await browser.newContext();const page=await context.newPage();const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('request',r=>requests.push(r.url()));
 for(const width of [1440,1024,961,960,768,760,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/portfolio.html');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').textContent(),'Skip to portfolio');await page.keyboard.press('Enter');assert.equal(await page.locator(':focus').getAttribute('id'),'main-content');
  if(width<=960){await page.locator('header .menu').click();assert.equal(await page.locator('header .menu').getAttribute('aria-expanded'),'true');await page.locator('header .menu').click();}
  assert.equal(await page.locator('header nav a[href*="ercot"]').count(),0);
  const cta=page.getByRole('link',{name:'Explore Dashboard',exact:true});assert.equal(await cta.getAttribute('href'),'/projects/ercot/index.html');
  for(const selector of ['.portfolio-feature__note','.portfolio-feature .button','.portfolio-feature h3']){const c=await colors(page,selector);assert.ok(ratio(c.foreground,c.background)>=4.5,`${selector} contrast`)}
  await cta.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await page.locator(':focus').getAttribute('href'),'/projects/ercot/index.html');
  assert.equal(await cta.evaluate(el=>getComputedStyle(el).outlineWidth),'3px');
  if(process.env.ERCOT_SCREENSHOT_DIR&&[1440,390].includes(width)){
   await mkdir(process.env.ERCOT_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${process.env.ERCOT_SCREENSHOT_DIR}/ercot-phase5-portfolio-${width}.png`,fullPage:true});
  }
  const before=requests.length;await cta.press('Enter');await page.waitForURL(base+'/projects/ercot/index.html');await ready(page);
  const data=requests.slice(before).filter(url=>new URL(url).pathname.startsWith('/data/'));assert.equal(data.length,5);assert.ok(data.every(url=>!url.endsWith('/daily/zones.json')));
  assert.equal(await page.evaluate(()=>Object.keys(Chart.instances).length),4);
  const overlaps=await page.evaluate(()=>['ercot-daily-chart','ercot-monthly-chart'].flatMap(id=>{
    const chart=Chart.getChart(id),scale=chart.scales.x;let previous=-Infinity;const result=[];
    chart.ctx.save();chart.ctx.font=`12px ${Chart.defaults.font.family}`;
    scale.ticks.forEach((tick,index)=>{const width=chart.ctx.measureText(String(tick.label)).width;const center=scale.getPixelForTick(index);if(center-width/2<previous+2)result.push(id);previous=center+width/2});
    chart.ctx.restore();return result;
  }));assert.deepEqual(overlaps,[],'system calendar tick labels remain separated');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  assert.equal(await page.locator('h1').count(),1);
  const issues=await page.evaluate(()=>{
   const result=[];const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);if(ids.length!==new Set(ids).size)result.push('duplicate IDs');
   for(const el of document.querySelectorAll('input,select'))if(!document.querySelector(`label[for="${el.id}"]`))result.push('unlabeled '+el.id);
   for(const el of document.querySelectorAll('[aria-describedby]'))for(const id of el.getAttribute('aria-describedby').split(/\s+/))if(!document.getElementById(id))result.push('missing description '+id);
   for(const el of document.querySelectorAll('canvas'))if(el.getAttribute('role')!=='img'||!el.getAttribute('aria-label'))result.push('chart name missing');
   for(const table of document.querySelectorAll('table'))if(!table.caption||!table.caption.textContent.trim())result.push('missing caption');return result;
  });assert.deepEqual(issues,[]);
  const extent=await page.locator('#ercot-measurement-coverage').textContent();assert.equal(await page.locator('#ercot-method-coverage').textContent(),`Published measurement coverage: ${extent}.`);
  assert.match(await page.locator('.ercot-preview-note').textContent(),/not live grid monitoring/);
  for(const selector of ['.ercot-preview-note','#ercot-dataset-note','.ercot-source-links a']){const c=await colors(page,selector);assert.ok(ratio(c.foreground,c.background)>=4.5,`${selector} contrast`)}
  const control=await colors(page,'#ercot-daily-start','borderTopColor');assert.ok(ratio(control.foreground,control.background)>=3,'control boundary contrast');
  const jump=page.getByRole('navigation',{name:'Dashboard sections'}).getByRole('link',{name:'Weather zones',exact:true});await jump.focus();await jump.press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('id'),'ercot-zone-monthly-panel');
  const position=await page.evaluate(()=>({top:document.querySelector('#ercot-zone-monthly-panel').getBoundingClientRect().top,header:document.querySelector('body > header').getBoundingClientRect().bottom}));assert.ok(position.top>=position.header-2,'section title clear of sticky header');
  await page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('link',{name:'Portfolio',exact:true}).click();await page.waitForURL(base+'/portfolio.html');assert.equal(await page.getByRole('link',{name:'Explore Dashboard',exact:true}).count(),1);
  pass(`Portfolio ↔ explicit dashboard URL, keyboard/menu/jump links, contrast and chart/table labels at ${width}px`);
 }
 assert.deepEqual(errors,[]);
 await context.close();
 const prodContext=await browser.newContext();const prod=await prodContext.newPage();const prodRequests=[],prodErrors=[];
 prod.on('request',r=>prodRequests.push(r.url()));prod.on('pageerror',e=>prodErrors.push(e.message));prod.on('console',m=>{if(m.type()==='error')prodErrors.push(m.text())});
 await prod.route(production+'/**',async route=>{
  const url=new URL(route.request().url());const response=await prod.request.get(base+url.pathname+url.search);
  await route.fulfill({response});
 });
 await prod.goto(production+'/portfolio.html');await prod.getByRole('link',{name:'Explore Dashboard',exact:true}).click();await prod.waitForURL(production+'/projects/ercot/index.html');await ready(prod);
 assert.ok(prodRequests.every(url=>url.startsWith(production+'/')));assert.ok(prodRequests.includes(production+'/data/ercot/manifest.json'));assert.ok(prodRequests.some(url=>url.endsWith('/js/vendor/chart-4.6.1.umd.min.js')));assert.ok(!prodRequests.some(url=>url.endsWith('/daily/zones.json')));
 await prod.locator('#ercot-zone-daily-explorer > summary').click();await prod.locator('#ercot-zone-daily-panel .ercot-badge').filter({hasText:'Chart loaded'}).waitFor();assert.equal(await prod.evaluate(()=>Object.keys(Chart.instances).length),5);
 await prod.locator('#ercot-zone-daily-explorer > summary').click();await prod.locator('#ercot-zone-daily-explorer > summary').click();assert.equal(prodRequests.filter(url=>url.endsWith('/daily/zones.json')).length,1);assert.equal(await prod.evaluate(()=>Chart.version),'4.6.1');assert.deepEqual(prodErrors,[]);
 await prod.locator('.ercot-back-link').click();await prod.waitForURL(production+'/portfolio.html');
 pass('production-origin simulation: nested assets, same-origin manifest, pinned Chart.js, lazy reuse and return link; no actual production deployment');await prodContext.close();
 console.log(`${groups} portfolio/release browser check groups passed.`);
}finally{await browser.close()}

