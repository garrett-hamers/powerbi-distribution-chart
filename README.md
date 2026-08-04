# Atlyn Distribution

Atlyn Distribution is a certification-first Power BI custom visual for grouped
raw-observation distributions. Its required raw contract is exactly one
`Category` grouping, exactly one `Sample` grouping, and exactly one numeric
`Value` measure. The runtime also rejects ungrouped Category/Value aggregates,
because an aggregate is not a raw distribution. It calculates Hyndman-Fan Type
7 quartiles and uses Tukey 1.5xIQR inlier whiskers. Duplicate outlier
observations are retained. When IQR is zero, the repeated value is still the
Tukey fence, so any value outside that fence remains a genuine outlier.

The raw-observation contract is deliberately bounded to the 30,000-row host
window. This release does not call `fetchMoreData`: categorical grouped
segments cannot be appended safely without a host-level proof that sample
identity and duplicate rows are reconciled. Instead, the visual reports the
received, rendered, invalid, and dropped row counts, visibly labels a full
window as potentially partial, and never claims population completeness. It
also provides native host tooltips with touch long-press behavior,
selection/highlight/context-menu integration, keyboard navigation, RTL,
high-contrast, reduced-motion, localization, mobile/touch behavior, and an
accessible summary table.

## Development

```text
npm ci
npm test
npm run build
npm run eslint
npm run package
npm run package:reproducible
npm run release:metadata
npm audit
npm run audit:submission
npm run certification-audit
```

## Release artifacts

`npm run package` and `npm run certification-audit` normalize the generated
PBIVIZ ZIP entry order, timestamps, permissions, platform, and compression
before atomically replacing the artifact. Stale `dist` PBIVIZ files are
removed, and exactly one package matching the generated manifest is required.
The reproducibility gate packages twice from the same source and requires the
exact filename, byte count, and SHA-256 to match. A release manifest must
record the final main commit, package filename, SHA-256, Node/npm versions, and
`powerbi-visuals-tools` version; upload that exact file to Blob/AppSource
instead of regenerating it.
`npm run release:metadata` writes that deterministic manifest to
`dist/release-metadata.json` and validates the checked-in Partner Center logo at
`assets/logo-300x300.png` and the listing screenshots in `assets/screenshots`.

## AppSource submission assets

`docs/partner-center-submission.md` is the submission dossier: it records every
Partner Center field with its final value, the compliance statements, and the
remaining manual steps the owner has to perform. `EULA.md` is the listing EULA.

`npm run audit:submission` is the deterministic gate for those assets. It checks
the required `pbiviz.json` fields (name, display name, frozen GUID, four-part
version, description, https support URL, author name and email), that the logo is
a real 300x300 PNG, that `assets/screenshots` holds one to five PNGs at exactly
1366x768 and at most 1024 KB each, that the EULA and dossier are present and
cross-linked, and that `assets/sample-data/atlyn-distribution-sample.csv` still
matches its deterministic generator. It also reports whether the sample `.pbix`
is present; Microsoft requires one, but only Power BI Desktop can author it, so
that step stays with the owner and is never faked here.

`npm run screenshots` regenerates `assets/screenshots` from the *packaged*
visual. It runs `npm run package`, extracts the bundled JavaScript from the
`.pbiviz`, serves `tools/screenshots` on loopback, and captures each scene over
the Chrome DevTools Protocol at exactly 1366x768. It needs a locally installed
Chrome, Edge, or Chromium (or `CHROME_PATH`) and Node 22 or newer, and it fails
loudly rather than producing a placeholder if no browser is available. CI does
not run it; CI validates the committed PNGs instead.

`npm run sample-data` rewrites the offline sample CSV from the same deterministic
module the screenshot harness uses, so the committed dataset and the committed
screenshots can never drift apart.

The package has no privileges, network access, external assets, or unsafe DOM
APIs. Microsoft certification and validation in a real Power BI host are not
claimed by this repository. The visual also respects the host's
`allowInteractions` capability and caps rendered point markers per
distribution to keep large bounded data windows responsive.
