# ERCOT portfolio release review — Phase 5

**Local implementation is reviewed; production deployment is not approved or verified.**
Nothing in this phase commits, pushes, changes AWS, or triggers CodePipeline.

## Confirmed from the repository

- The static site has no tracked buildspec, pipeline definition, deploy script,
  infrastructure template, artifact filter, or invalidation configuration.
- `server.js` is ignored by `.gitignore` and is untracked. It is development-only.
  `node_modules/` and all `*.json` are also ignored. No ERCOT JSON is bundled.
- `scripts/`, `tests/`, `docs/` and README are **not** excluded by `.gitignore`.
  Once committed, they may be included in the GitHub Source artifact. Git ignore
  rules do not remove tracked files or filter the Deploy action's artifact.
- Source → Deploy → Invalidate, the `main` trigger and bucket/domain names are
  supplied project context, not independently verified live AWS settings.
- There are no website files under `data/ercot/` in this checkout. Data lives in
  the independently published bucket prefix and must not enter the site artifact.
- The intended public allowlist is `PUBLIC_FILES` in `scripts/check-release.mjs`.
  It includes all current public pages/assets and the Chart.js 4.6.1 bundle and
  license. It excludes server.js, Node packages, scripts, tests, fixtures, docs,
  Git metadata and the entire data prefix. The checker only reads local files.

Run the local audit:

```powershell
node scripts/check-release.mjs
```

**This allowlist is not wired to CodePipeline.** Its successful audit confirms
local paths and intended artifact contents, not what AWS will deploy. A direct,
unfiltered Source artifact would still risk publishing development scripts and
tests when they are committed. Do not treat `.gitignore`, this document, or a
passing local check as an artifact exclusion mechanism. No unverified
`.gitattributes`/archive exclusion is assumed.

## Required review before any main push

1. Inspect the actual Source output artifact and both Deploy and Invalidate
   action definitions. Confirm the artifact root corresponds to the website root.
   Verify the deployed files match the public allowlist, excluding development
   tooling. Decide how the existing release process will filter the artifact;
   changing AWS or adding pipeline stages is outside Phase 5.
2. Confirm Deploy uses the intended provider, target bucket
   `schleigeranalytics.com` and extraction/root settings. A standard CodePipeline
   S3 deploy action uploads extracted artifact objects; its documented settings
   do not include a sync/delete option. That does **not** establish what a custom
   action or later stage in this particular pipeline runs. Review all commands
   for bucket-root cleanup, destructive sync, or writes to `data/ercot/*`.
3. Preserve `data/ercot/manifest.json` and every referenced generation object.
   Never sync a website-only directory to the bucket root with `--delete` unless
   the independent data prefix is explicitly and demonstrably protected. An
   object at the same key could overwrite JSON or its cache metadata; therefore
   the website artifact must contain no `data/ercot/` keys.
4. Preserve the data caching strategy: manifest 60 seconds with revalidation;
   generation JSON immutable for one year. Do not reapply website cache settings
   to data objects. Confirm HTML/module/CSS/Chart.js MIME types, including nested
   dashboard modules, and the existing CloudFront behavior for `/data/ercot/*`.
5. Use `/projects/ercot/index.html`, including for Portfolio and canonical links.
   The `/projects/ercot/` directory shortcut is not production-verified. Existing
   S3/CloudFront directory rewriting is not inferred from the local preview.
6. Review the actual invalidation stage and cache strategy for the changed
   Portfolio/HTML, unversioned CSS and JS modules and pinned Chart.js bundle.
   Prefer invalidating changed website paths while retaining immutable data
   caching. No invalidation is executed in Phase 5.
7. Review the uncommitted/untracked Phase 1–5 files together. A push to `main`
   triggers deployment per the supplied workflow, so release approval and the
   external checks above must precede that action.

AWS reference inspected during this review:
https://docs.aws.amazon.com/codepipeline/latest/userguide/action-reference-S3Deploy.html

## Verified local production paths

- Portfolio CTA: `/projects/ercot/index.html`.
- Dashboard breadcrumb/return links resolve to `/portfolio.html`.
- Dashboard assets resolve under `/css/`, `/js/`, `/assets/`; module-relative
  imports and the pinned Chart.js script stay on the same website origin.
- Manifest: `https://www.schleigeranalytics.com/data/ercot/manifest.json` in
  production, selected via `location.origin`. The loader restricts the origin,
  prefix, generation and filenames. CORS is not required for production.
- Local preview uses the same paths at localhost:3000; it serves a validated
  snapshot and lazily captures daily-zone data without altering production CORS.

## Local verification and remaining release work

Run all unit tests and the three browser check scripts described in README.
Check Portfolio → dashboard → Portfolio, keyboard navigation, current metadata,
all five charts, supporting tables, retries, and lazy daily-zone activation.
The implementation makes no new analytical claims: the initial dataset covers
January–September 2026; current coverage is always taken from the manifest and
summary, separately from the export timestamp. This is historical analysis.

After a separately approved deployment, verify the explicit production URL,
asset MIME types, manifest/summary generation agreement, absence of tooling in
the deployed artifact, retention of the independently published data, and
CloudFront cache propagation. Those production checks cannot be claimed from a
local preview. No credential or infrastructure change is part of this phase.
