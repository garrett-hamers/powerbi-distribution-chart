# Atlyn Distribution offline sample report

`AtlynSample.pbip` is the Microsoft-required sample report for the AppSource
submission. It is a Power BI Desktop project stored in the documented PBIR
(report) and TMDL (semantic model) text formats, emitted directly by
`scripts/build-sample-report.mjs` with no third-party tooling.

- The semantic model holds all 200 rows in a **DAX calculated table**
  (`DATATABLE(...)`). There is no Power Query partition and no data source object,
  so there is nothing to authenticate and nothing to connect to. The table must
  still be evaluated before it holds rows - see the refresh step below.
- The visual is embedded as a private custom visual under
  `AtlynSample.Report/CustomVisuals/`, so the report renders with no AppSource lookup.

Regenerate with `npm run package` then `npm run sample-report`.
`npm run audit:submission` fails if the checked-in project drifts from the generator.

## Producing the `.pbix`

A PBIP stores definitions only and **caches no data**, so Power BI Desktop opens
this project reporting *"Some of the tables have incomplete or no data."* That is
expected. Two manual steps, in this order:

1. Open `AtlynSample.pbip` in Power BI Desktop, then **REQUIRED:**
   **Home > Refresh > Schema and data**. This evaluates the calculated table and
   materializes its 200 rows. Skipping it saves a `.pbix` with **empty tables**,
   which fails AppSource review. The refresh must complete with no credential or
   data source prompt; if Desktop asks for credentials, something external has
   entered the model and the sample is no longer offline.
2. **File > Save As** a `.pbix`, then re-open it and confirm the visual still
   renders 200 rows.

See `docs/partner-center-submission.md` section 4.1 for the full procedure.
