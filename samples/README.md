# Atlyn Distribution offline sample report

`atlyn-distribution-sample.pbip` is the Microsoft-required sample report for the
AppSource submission. It is a Power BI Desktop project stored in the documented
PBIR (report) and TMDL (semantic model) text formats.

- The semantic model holds all 200 rows as an inline Power Query `#table(...)`
  literal, so it refreshes with no data source and no credentials.
- The visual is embedded as a private custom visual under
  `atlyn-distribution-sample.Report/CustomVisuals/`, so the report renders with no AppSource lookup.

Regenerate with `npm run sample-report` after `npm run package`.
`npm run audit:submission` fails if the checked-in project drifts from the generator.

Producing the `.pbix` itself requires one manual Power BI Desktop save; see
`docs/partner-center-submission.md` section 4.1.
