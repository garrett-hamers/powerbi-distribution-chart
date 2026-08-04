# Changelog

## Unreleased

- Preserve Tukey outliers when a distribution has zero IQR.
- Keep category identities, locale-aware dates, and interaction permissions aligned with host data.
- Add direct Power BI security linting, certification-audit packaging, CI, and release metadata.
- Add a checked-in Partner Center-ready 300x300 PNG logo and deterministic release-metadata generation.
- Point the packaged support URL and author email at the published Atlyn support channels.
- Add three real 1366x768 AppSource listing screenshots captured from the packaged visual, plus the offline harness and deterministic sample dataset behind them.
- Add an AppSource EULA, a Partner Center submission dossier, and a deterministic `npm run audit:submission` gate wired into CI and the certification audit.
- Record the owner-confirmed free, non-transactable AppSource listing decision and its separation from the Atlyn Stripe subscription.
- Add a deterministic offline sample report project (PBIP + PBIR + TMDL) whose data is a DAX calculated table with no data source object, and with the built visual embedded for offline rendering.
- Pin the line endings of packaged text assets so the PBIVIZ is byte-identical across Windows and Linux, not just reproducible per operating system.

## 1.0.0

- Initial grouped raw-observation distribution visual with Type 7 quartiles and Tukey whiskers.
