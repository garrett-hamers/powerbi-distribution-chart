# Atlyn Distribution offline sample report

`AtlynSample.pbip` is the Microsoft-required sample report for the AppSource
submission. It is a Power BI Desktop project stored in the documented PBIR
(report) and TMDL (semantic model) text formats, emitted directly by
`scripts/build-sample-report.mjs` with no third-party tooling.

- The semantic model holds all 200 rows in a **DAX calculated table**
  (`DATATABLE(...)`). There is no Power Query partition and no data source object,
  so there is nothing to authenticate and nothing to connect to. The table still
  has to be evaluated before it holds rows - see the check below.
- The visual is embedded as a private custom visual under
  `AtlynSample.Report/CustomVisuals/`, so the report renders with no AppSource lookup.

Regenerate with `npm run package` then `npm run sample-report`.
`npm run audit:submission` fails if the checked-in project drifts from the generator.

## Producing the `.pbix`

1. Open `AtlynSample.pbip` in Power BI Desktop and **confirm the visual renders
   with data** - the diagnostics line should report 200 received and 200 rendered
   rows.
2. If any table is empty, or Desktop reports *"Some of the tables have incomplete or
   no data"*, run **Home > Refresh > Schema and data** and re-check. The committed
   project carries no cached model data. Whether Desktop evaluates this calculated
   table on open has not been verified, so check rather than assume - saving while
   the tables are empty ships a `.pbix` with no data, which fails AppSource review.
3. **File > Save As** a `.pbix`, then re-open it and confirm the visual still
   renders 200 rows.

If Desktop ever prompts for credentials, authentication, or a data source, something
external has entered the model and the sample is no longer offline. Stop and
investigate.

See `docs/partner-center-submission.md` section 4.1 for the full procedure.
