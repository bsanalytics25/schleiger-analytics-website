# Schleiger Analytics website

Static HTML, CSS and vanilla JavaScript. The ERCOT project is at
`projects/ercot/index.html`. No frontend build or npm install is required.

## Local ERCOT preview (Node.js 22.7+)

From this repository:

```powershell
node scripts/serve-ercot-preview.mjs
```

Open http://localhost:3000/projects/ercot/ and stop with Ctrl+C. Stop any other
server on port 3000 first. This development-only command captures the real public
manifest, summary, daily system, monthly system and monthly-zone reports into memory at
startup, validates them, and serves those five files with the static website.
Daily-zone data is captured only on its first requested activation, using the same
client and manifest; failures can retry without recapturing successful reports.
Restart to capture a new generation. No snapshots are written to disk. There is
no production backend or general proxy. Hidden directories, tooling, tests and
node_modules are excluded; other ERCOT data routes return 404. Do not publish
this development script as an application server.

On October 27, 2026, public manifest/summary responses to
`Origin: http://localhost:3000` had no `Access-Control-Allow-Origin` header;
a browser verified CORS blocks direct localhost reads. Use the preview instead
of modifying production CORS, disabling browser security, or using unreadable
`no-cors` responses. The older Express static server alone lacks the JSON routes.

## Data contract and caching

The production page uses same-origin `/data/ercot/manifest.json`. Only its summary,
daily system, monthly system and monthly-zone reports are fetched initially.
The larger daily-zone report is requested only when its explorer opens. Schema **1.0.0** is supported
explicitly. The live schema and report fields were inspected before each phase.
No hourly, standalone coverage/peak, or runtime schema fetch occurs. Zone peaks reuse
the summary request, including when its UI retries independently.

A validated manifest is frozen for the session and shared across independent
report requests. Successes and in-flight work are reused. Failed reports alone
are evicted and can retry against the same captured generation. A failed manifest
can retry until validation succeeds. URL paths must match the permitted origin,
`/data/ercot/` prefix, generation and logical report name; redirects are rejected.
Metadata must match the captured manifest. Rows validate types, required fields,
nonnegative decimal strings, finite display values, counts, dates, period bounds,
unique system periods or zone-period pairs, selected zone codes (excluding ERCOT
from zone reports), and minimum/average/peak ordering. Decimal strings remain
available alongside rounded numeric display copies. Hash/byte fields are checked
structurally, not recomputed by the browser.

Data requests time out after 12 seconds, send no credentials and use default
browser caching. The public manifest has `public, max-age=60, must-revalidate`;
generation files have `public, max-age=31536000, immutable`. No polling or cache
busting is used. Only the development snapshot uses `no-store`.

## System charts (Phase 3)

Daily lines show average/peak demand (MW) and optional minimum demand. The date
range is bounded by observed system daily records and filters inclusively.
Missing dates inside the chosen range are explicit null points: lines do not
bridge them, tables say unavailable, and nothing is zero-filled. Triangles and
coverage notes flag observation-count mismatches. Bounds do not imply complete
coverage. Empty reports disable controls and show an explicit no-data state.
Invalid filters preserve the last valid chart with an accessible error message.

Monthly bars support average demand (MW), peak demand (MW) and observed total
energy (MWh). These are published aggregates and never change with the daily
filter. Missing months remain unavailable. Partial calendar months caused by
reporting-range bounds are identified even if observed/expected counts match.
Counts and partial-period notes appear in tooltips and supporting tables.

The summary, charts and data tables have independent loading/error/retry states.
A chart library or canvas failure preserves its populated data table. Each
canvas has a description; forms and table alternatives work with the keyboard.
Tables scroll inside their panels on narrow screens. Daily and monthly labels
use UTC calendar operations for date-only strings, avoiding browser timezone
shifts. Charts use category axes, so no date adapter is needed.

Chart.js **4.6.1** is vendored as `js/vendor/chart-4.6.1.umd.min.js`, with
`js/vendor/Chart.js-LICENSE.md` (MIT). It is loaded once as a local classic UMD
script when a chart has data; the shared loader retries library failures. No
runtime CDN, framework, bundler, date library or chart plugin is used.
Upstream package: https://www.npmjs.com/package/chart.js/v/4.6.1
Bundle SHA-256: `87364cc2b2a76a6684929e7d6b80b18a897794db38400caff1fcf1791c6925d2`.

## Weather-zone exploration (Phase 4)

Monthly zone bars compare the selected zones for one reporting month, with average
or peak demand (MW), or observed total energy (MWh). The initial month is the latest
with observations. A horizontal layout keeps all eight zone codes readable on
narrow screens. A table provides full zone names, counts and partial-period notes.
Monthly minimum demand is not exported and is not offered.

The daily explorer is a native collapsed disclosure. Neither the browser nor the
local preview downloads the larger `daily/zones.json` until it is activated. The
report is reused across opening/closing, changing zones and filtering dates. A
single zone is selected initially; an optional second zone adds only its average
and peak lines (four lines maximum). Duplicate zone comparisons are disabled and
rejected by the model. Date limits use the combined observed extent of the chosen
zones; each zone can have different gaps. Empty zones remain selectable and show
unavailable data rather than zero. Other charts and reporting-period KPIs are
independent of these filters.

Zone peak bars and a sortable table reuse validated summary data; no standalone
peak report is fetched. Column buttons sort by zone, numeric peak demand or local
peak timing, with `aria-sort` and a live result announcement. Unavailable sort
values remain last. The table and chart share the order. Reporting dates and
local hour-ending labels/occurrences are retained separately, including midnight
and DST repeated hours. The reporting period is explicit. Independent zone peaks
occur at different times: they are never summed or presented as a system peak.

The dataset selects its weather zones; a future subset is respected without
inventing absent series. Metadata-selected zones with no observations remain
visible as unavailable. Count mismatches and gaps appear in statuses/tables and
line markers. Count equality still cannot detect unexpected keys replacing
missing keys; use the global coverage audit. Monthly/daily zone reports contain
aggregates, not hourly observations, hourly contribution ratios, or weather.
The current production bundle covers January–September 2026: 72 monthly-zone rows
and 2,184 daily-zone rows. The daily-zone file is approximately 695 KB before
HTTP compression. Empty/gap/incomplete paths are tested with altered responses.
## Interpretation and limits

Reporting-period peaks are not all-time records. The dataset measurement extent,
reporting range and UTC export timestamp are separate; a recent export does not
imply current measurements. Hour-ending labels and occurrences retain ERCOT
local-time/HE24/DST semantics. Daily/monthly reports cannot supply hourly curves
or daily/monthly peak timestamps. The summary alone supplies the reporting-period
peak timestamp. Daily data includes minimum demand; monthly data does not.

Count equality alone cannot rule out unexpected records replacing missing keys;
consult the dataset audit and quality status. Global quality can reflect a
weather-zone issue even when system counts match. Coverage audits schedules,
not whether zone demand reconciles to the system total. Energy sums observed
one-hour measurements only; it is not imputed. Selected weather-zone count excludes
ERCOT and does not mean every zone has observations. Hourly curves, extra historical data, weather, forecasts and AI are future work.

## Validation

```powershell
node --test tests/ercot-data.test.mjs tests/ercot-system.test.mjs tests/ercot-zone.test.mjs tests/ercot-release.test.mjs
```

The unit/model suites contain synthetic fixtures used only in tests. Browser
checks use the real snapshot preview and deliberately altered responses for
failure/coverage cases. They verify eight widths (320–1440px), keyboard navigation,
canvas rendering, pointer tooltips, daily filtering/minimum, all monthly metrics,
gaps, empty reports, malformed/network/library/canvas failures, retries, and
single-generation loading, deferred daily-zone requests, and no external runtime requests.
Phase 4 adds month/metric selection, one/two-zone comparison, local peak timing,
keyboard-operated peak sorting, missing/empty zones, independent recovery and
lazy local-preview capture/cache tests.

With an existing Playwright installation and Edge (no package is added here):

```powershell
$env:ERCOT_PLAYWRIGHT_MODULE = 'C:\path\to\existing\node_modules\playwright'
node tests/ercot-charts.browser.mjs
node tests/ercot-zones.browser.mjs
node tests/ercot-portfolio.browser.mjs
```

Optional environment variables: `ERCOT_PREVIEW_URL` (default localhost:3000),
`ERCOT_BROWSER_CHANNEL` (default msedge), and `ERCOT_SCREENSHOT_DIR` to save
screenshots outside the source tree. Start the preview before browser checks.

## Portfolio integration and release review (Phase 5)

Portfolio now features ERCOT with technologies, a historical-data description and
an explicit `/projects/ercot/index.html` link. Dashboard section links reduce
scrolling; the breadcrumb and return link lead back to Portfolio. Methodology
links to ERCOT's load archive and the public manifest, distinguishes MW/MWh,
local hour endings and UTC export timestamps, and uses current validated coverage
in addition to the initial January–September 2026 release context.

Run `node scripts/check-release.mjs` for a read-only audit of the 25 intended
public files, links, module paths and anchors. It does not build, deploy or
configure artifact filtering. The actual Source → Deploy → Invalidate settings
are outside this repository. **Do not push to main before reviewing the real
artifact and confirming development-only files are excluded and `data/ercot/`
is preserved.** See `docs/ercot-production-readiness.md` for concrete findings,
external checks, caching/MIME considerations and remaining release work.

The Portfolio browser suite checks round-trip navigation, keyboard/focus behavior,
text/control contrast, chart/table labels, current methodology coverage, separated
mobile tick labels, and an intercepted production-origin simulation. That
simulation verifies paths against local assets; it is not a production deployment
or proof of the live pipeline configuration. Existing chart and lazy-load suites
remain required. Chart.js 4.6.1 is unchanged; no new analytical feature is added.
