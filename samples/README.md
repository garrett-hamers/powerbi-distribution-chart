# Atlyn Distribution offline sample report

`AtlynSample.pbip` is the Microsoft-required sample report for the AppSource
submission. It is a Power BI Desktop project stored in the documented PBIR
(report) and TMDL (semantic model) text formats, emitted directly by
`scripts/build-sample-report.mjs` with no third-party tooling.

- The semantic model holds all 200 rows in a **DAX calculated table**
  (`DATATABLE(...)`). There is no Power Query partition and no data source object,
  so there is nothing to authenticate and nothing to refresh.
- The visual is embedded as a private custom visual under
  `AtlynSample.Report/CustomVisuals/`, so the report renders with no AppSource lookup.

Regenerate with `npm run package` then `npm run sample-report`.
`npm run audit:submission` fails if the checked-in project drifts from the generator.

Producing the `.pbix` is one manual step: open the `.pbip` in Power BI Desktop and
**File > Save As** a `.pbix`. See `docs/partner-center-submission.md` section 4.1.
