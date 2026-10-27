// Development only: serve static assets and an in-memory snapshot of public system and zone reports.
// No general proxy, credential use, disk data writes or production security changes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCTION_MANIFEST, createDataClient, parseManifest, normalizeSummary, normalizeSystemReport, normalizeZoneReport } from '../js/ercot-data.js';

const lazySnapshots = new WeakMap();
const root = fileURLToPath(new URL('../', import.meta.url));
export async function publicSnapshot(fetchImpl = fetch, { includeSystem = true, includeZones = includeSystem } = {}) {
  // Reuse the production client validation, including the single-generation contract.
  const documents = new Map();
  const capture = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (response.ok) {
      const text = await response.clone().text();
      documents.set(new URL(url).pathname, text);
    }
    return response;
  };
  const client = createDataClient({ fetchImpl: capture });
  await client.load();
  if (includeSystem) await Promise.all(['daily/system.json', 'monthly/system.json'].map(name => client.loadReport(name)));
  if (includeZones) {
    await client.loadReport('monthly/zones.json');
    // The same client retains the captured manifest. No daily-zone download occurs
    // until the browser opens the explorer and asks for this one allowlisted path.
    lazySnapshots.set(documents, () => client.loadReport('daily/zones.json'));
  }
  return documents;
}
export function createPreviewServer(documents) {
  // Validate captured data again before serving it. The only served data routes are
  // the manifest, summary, system and zone reports; all other data is 404.
  const rawManifest = documents.get('/data/ercot/manifest.json');
  const manifest = parseManifest(JSON.parse(rawManifest), PRODUCTION_MANIFEST);
  const summaryPath = new URL(manifest.files['summary.json'].url).pathname;
  normalizeSummary(JSON.parse(documents.get(summaryPath)), manifest);
  const allowedData = new Map([['/data/ercot/manifest.json', rawManifest], [summaryPath, documents.get(summaryPath)]]);
  for (const name of ['daily/system.json', 'monthly/system.json', 'monthly/zones.json', 'daily/zones.json']) {
    const reportPath = new URL(manifest.files[name].url).pathname;
    if (documents.has(reportPath)) {
      const normalize = name.endsWith('/zones.json') ? normalizeZoneReport : normalizeSystemReport;
      normalize(JSON.parse(documents.get(reportPath)), manifest, name.split('/')[0]);
      allowedData.set(reportPath, documents.get(reportPath));
    }
  }
  const dailyZonePath = new URL(manifest.files['daily/zones.json'].url).pathname;
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/data/')) {
      if (pathname === dailyZonePath && !allowedData.has(pathname) && lazySnapshots.has(documents)) {
        try {
          await lazySnapshots.get(documents)();
          const text = documents.get(pathname);
          normalizeZoneReport(JSON.parse(text), manifest, 'daily');
          allowedData.set(pathname, text);
        } catch {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Daily zone snapshot unavailable; retry."}');
          return;
        }
      }
      const text = allowedData.get(pathname);
      res.writeHead(text === undefined ? 404 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : text);
      return;
    }
    try {
      // Serve only public static website assets, never .git, node_modules or tooling.
      const decoded = decodeURIComponent(pathname);
      if (!/^\/(?:$|(?:assets|css|js|projects)\/|(?:index|about|contact|packages|portfolio|services)\.html$)/.test(decoded) || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.')) || /^\/(node_modules|scripts|tests)(\/|$)/.test(decoded)) { res.writeHead(404).end(); return; }
      let relative = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
      const target = path.resolve(root, `.${relative}`);
      if (!target.startsWith(root) || !['.html', '.css', '.js', '.png', '.jpeg', '.jpg', '.svg', '.ico'].includes(path.extname(target).toLowerCase())) { res.writeHead(404).end(); return; }
      const bytes = await readFile(target);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const documents = await publicSnapshot();
    const server = createPreviewServer(documents);
    server.on('error', error => { console.error(`Preview could not start: ${error.message}`); process.exitCode = 1; });
    server.listen(3000, 'localhost', () => console.log('ERCOT preview: http://localhost:3000/projects/ercot/ (real public snapshot captured at startup; restart to update)'));
  } catch (error) { console.error(`Public snapshot unavailable: ${error.message}`); process.exitCode = 1; }
}




