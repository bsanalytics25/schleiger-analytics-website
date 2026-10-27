// Read-only release audit. This does not package, upload, delete, or configure AWS.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
export const SITE_ORIGIN = 'https://www.schleigeranalytics.com';
export const PUBLIC_FILES = Object.freeze([
 'index.html','services.html','packages.html','portfolio.html','about.html','contact.html',
 'projects/ercot/index.html',
 'assets/images/schleiger-analytics-logo.png','assets/images/headshot.JPEG',
 'css/styles.css','css/branding.css','css/home.css','css/portfolio.css','css/packages.css','css/headshot-full.css','css/ercot.css',
 'js/main.js','js/ercot-data.js','js/ercot-dashboard.js','js/ercot-chart-model.js','js/ercot-charts.js','js/ercot-zone-model.js','js/ercot-zone-charts.js',
 'js/vendor/chart-4.6.1.umd.min.js','js/vendor/Chart.js-LICENSE.md'
]);
export function siteReference(value, from) {
  const url = new URL(value, `${SITE_ORIGIN}/${from}`);
  if (['mailto:', 'tel:'].includes(url.protocol)) return { external: true };
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`Unsafe URL scheme: ${value}`);
  if (url.origin !== SITE_ORIGIN) return { external: true };
  const key = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
  return { key, hash: decodeURIComponent(url.hash.slice(1)), data: key.startsWith('data/ercot/') };
}
export async function auditRelease(root = fileURLToPath(new URL('../', import.meta.url))) {
  const issues = [];
  for (const file of PUBLIC_FILES) {
    try { if (!(await stat(path.join(root, file))).isFile()) issues.push(`Not a file: ${file}`); }
    catch { issues.push(`Missing public file: ${file}`); }
  }
  for (const file of PUBLIC_FILES.filter(name => /\.(html|js|css)$/.test(name) && !name.includes('/vendor/'))) {
    let source;
    try { source = await readFile(path.join(root, file), 'utf8'); } catch { continue; }
    const references = file.endsWith('.html') ? [...source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(match => match[1])
      : file.endsWith('.js') ? [...source.matchAll(/(?:\bfrom\s*|\bnew URL\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
      : [...source.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)].map(match => match[1]);
    for (const value of references) {
      try {
        const ref = siteReference(value, file);
        if (ref.external) continue;
        if (ref.data) {
          if (ref.key !== 'data/ercot/manifest.json') issues.push(`Unexpected fixed data link: ${file} -> ${value}`);
          continue;
        }
        if (!PUBLIC_FILES.includes(ref.key)) { issues.push(`Reference outside public allowlist: ${file} -> ${value}`); continue; }
        if (ref.hash && ref.key.endsWith('.html')) {
          const target = await readFile(path.join(root, ref.key), 'utf8');
          if (![...target.matchAll(/\bid=["']([^"']+)["']/g)].some(match => match[1] === ref.hash)) issues.push(`Missing anchor: ${file} -> ${value}`);
        }
      } catch (error) { issues.push(`${file} -> ${value}: ${error.message}`); }
    }
  }
  return { files: [...PUBLIC_FILES], issues };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditRelease();
  if (result.issues.length) { console.error(result.issues.join('\n')); process.exitCode = 1; }
  else console.log(`Verified ${result.files.length} intended public files and their static references.\nRead-only audit: CodePipeline artifact filtering and data/ercot/ preservation remain externally unverified.`);
}
