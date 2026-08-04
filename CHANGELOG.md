# Changelog

## Unreleased

- Fail the dependency audit on any advisory, not just high and critical. `npm run audit` and the CI step now run a plain `npm audit`, matching the other five visuals in the portfolio; `--audit-level=high` had been masking a moderate advisory the rest of the portfolio already fails on. `npm run audit:production` keeps `--omit=dev` but drops the same threshold, so it differs from `npm run audit` only in scope.
- Pin `hono` to `^4.12.34` through `overrides` to clear GHSA-8j4g-w8fx-2239, a ReDoS in hono's CORS middleware reached transitively through `powerbi-visuals-tools`.

## 1.0.1

Prepares the visual for its Microsoft AppSource / Partner Center submission.

- Ship the packaged visual icon as a real 20x20 PNG rendered from `assets/icon.svg`. Previously `assets.icon` pointed at an SVG, which `powerbi-visuals-tools` relabels as `assets/icon.png` in the packaged manifest while embedding an `image/svg+xml` payload, without validating the format or the dimensions. This version bump exists because that correction changes the packaged bytes, and the storefront distributes artifacts from version-keyed paths.
- Point the packaged support URL and author email at the published Atlyn support channels.
- Add three real 1366x768 AppSource listing screenshots captured from the packaged visual, plus the offline harness and deterministic sample dataset behind them.
- Add an AppSource EULA, a Partner Center submission dossier, and a deterministic `npm run audit:submission` gate wired into CI and the certification audit.
- Record the owner-confirmed free, non-transactable AppSource listing decision and its separation from the Atlyn Stripe subscription.
- Add a deterministic offline sample report project (PBIP + PBIR + TMDL) whose data is a DAX calculated table with no data source object, and with the built visual embedded for offline rendering.
- Pin the line endings of packaged text assets so the PBIVIZ is byte-identical across Windows and Linux, not just reproducible per operating system.
- Preserve Tukey outliers when a distribution has zero IQR.
- Keep category identities, locale-aware dates, and interaction permissions aligned with host data.
- Add direct Power BI security linting, certification-audit packaging, CI, and release metadata.
- Add a checked-in Partner Center-ready 300x300 PNG logo and deterministic release-metadata generation.

The visual GUID is unchanged, so v1.0.1.0 is the same product as v1.0.0.0 and existing reports keep working.

## 1.0.0

- Initial grouped raw-observation distribution visual with Type 7 quartiles and Tukey whiskers.
