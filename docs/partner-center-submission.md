# Atlyn Distribution - Partner Center submission dossier

This document is the single source of truth for the Microsoft AppSource /
Partner Center listing of the **Atlyn Distribution** Power BI custom visual. Every
field below records the concrete final value that ships from this repository.

Microsoft's published requirements for Power BI visual submissions are documented at
<https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store>.

Nothing in this document asserts that the visual has been certified, validated, or
accepted by Microsoft. It records what this repository provides and what the owner
still has to do by hand.

## 1. Package metadata (`pbiviz.json`)

| Partner Center field | Value | Source |
| --- | --- | --- |
| Visual name | `atlynDistribution` | `pbiviz.json` -> `visual.name` |
| Display name | `Atlyn Distribution` | `pbiviz.json` -> `visual.displayName` |
| GUID (**frozen**) | `atlynDistributionA1B2C3D4E5F6G7H8I9J0` | `pbiviz.json` -> `visual.guid` |
| Version (four-part) | `1.0.1.0` | `pbiviz.json` -> `visual.version` |
| API version | `5.11.0` | `pbiviz.json` -> `apiVersion` |
| Description | "Compare grouped distributions at a glance. Atlyn Distribution renders raw observations as box plots with Hyndman-Fan Type 7 quartiles, Tukey 1.5xIQR whiskers, mean markers, and genuine outliers, plus transparent row-count diagnostics that never overstate data completeness." | `pbiviz.json` -> `visual.description` |
| Support URL | <https://atlyn.io/contact> | `pbiviz.json` -> `visual.supportUrl` |
| Author name | `Atlyn` | `pbiviz.json` -> `author.name` |
| Author email | `atlyn.help@gmail.com` | `pbiviz.json` -> `author.email` |

> **Do not change the GUID.** It is already recorded in the storefront release
> manifest and in published download paths. `scripts/audit-submission-assets.mjs`
> and `tests/package.test.ts` both pin it.

### Package artifact

| Field | Value |
| --- | --- |
| Artifact filename | `atlynDistributionA1B2C3D4E5F6G7H8I9J0.1.0.1.0.pbiviz` |
| Build command | `npm run package` |
| Reproducibility gate | `npm run package:reproducible` (packages twice, requires identical filename, byte count, and SHA-256) |
| Release manifest | `npm run release:metadata` -> `dist/release-metadata.json` |

Upload the exact `.pbiviz` recorded in `dist/release-metadata.json`. Do not
regenerate it between recording the manifest and uploading.

> **v1.0.1.0 supersedes the v1.0.0.0 artifact currently in Blob storage.**
>
> The packaged filename embeds the version, so v1.0.1.0 lands at a different
> version-keyed Blob path and does not overwrite the existing v1.0.0.0 object.
> Publish the new artifact, repoint the storefront release manifest at it, and
> retire the v1.0.0.0 entry.
>
> The bump exists because correcting the packaged icon to a real 20x20 PNG
> changed the artifact bytes. Shipping different bytes under the same version
> number would break the assumption that a version-keyed path identifies exactly
> one build. The GUID is deliberately unchanged, so the visual is still the same
> product and existing reports keep working.

## 2. Listing assets

| Partner Center field | Requirement | Value in this repository |
| --- | --- | --- |
| Visual icon (in the package) | PNG, exactly 20x20 | `assets/icon.png`, referenced by `pbiviz.json` -> `assets.icon` |
| Logo | PNG, exactly 300x300 | `assets/logo-300x300.png` |
| Screenshots | 1-5 PNGs, exactly 1366x768, each <= 1024 KB | `assets/screenshots/` (3 files, see below) |
| Support URL | https:// | <https://atlyn.io/contact> |
| Privacy policy URL | https:// | <https://atlyn.io/legal/privacy> |
| Terms of use | - | <https://atlyn.io/legal/terms> |
| EULA | A file, or Microsoft's standard contract | `EULA.md` |
| Sample report | `.pbix`, fully offline | Offline project committed at `samples/AtlynSample.pbip`; one manual Desktop **Save As** produces the `.pbix` - see section 4.1 |

### Visual icon

Microsoft's [visual project structure](https://learn.microsoft.com/en-us/power-bi/developer/visuals/visual-project-structure)
page states the icon "must be a **PNG** file with dimensions 20 pixels by 20
pixels". This is the icon shown in the Power BI visualizations pane, and it is
separate from the 300x300 Partner Center listing logo.

`powerbi-visuals-tools` **does not enforce this**. It base64-encodes whatever
`assets.icon` points at, maps a `.svg` extension to an `image/svg+xml` data URI,
and then hard-codes `assets: { icon: "assets/icon.png" }` into the packaged
manifest regardless of the source extension
(`powerbi-visuals-webpack-plugin/src/index.js`, lines 26-33 and 428). Pointing
`assets.icon` at an SVG therefore produces a package whose manifest claims PNG
while the payload is an SVG data URI, with no warning and no dimension check.

This repository does not rely on that undocumented tolerance:
`assets/icon.svg` remains the editable source, `npm run icon` renders it to
`assets/icon.png` at exactly 20x20 in a headless browser, and `pbiviz.json`
points `assets.icon` at the PNG. The packaged `iconBase64` is then a real
`data:image/png;base64,...` payload that matches the manifest.

`npm run audit:submission` asserts all three image contracts separately:
`assets/icon.png` exactly 20x20, `assets/logo-300x300.png` exactly 300x300, and
each screenshot exactly 1366x768 and at most 1024 KB.

### Licensing and pricing - FREE listing (owner-confirmed)

**AppSource listing: Free.**

The visual is published to AppSource as a **free, non-transactable offer**. Do not
configure a paid offer, a price, a trial, or any Partner Center transactability
option.

Monetization happens **only** through the Atlyn storefront subscription at
<https://atlyn.io>, billed through Stripe. That subscription is a separate
commercial relationship between Atlyn and the customer. It is not sold, metered,
enforced, or licensed through Microsoft.

In other words: **AppSource licensing is separate from the Atlyn Stripe
subscription.** The AppSource offer grants the visual itself under `EULA.md` at no
charge; the Atlyn subscription covers the wider Atlyn product and is out of scope
for Partner Center. Nothing in the packaged visual performs a license check, calls
a licensing service, or gates functionality - `capabilities.json` declares no
privileges and the visual makes no network calls at all.

### Screenshots

All three are real renders of the *packaged* visual driven through a mock Power BI
host over the offline sample dataset. They are produced by `npm run screenshots`
(`scripts/capture-screenshots.mjs` + `tools/screenshots/`), which packages the
visual, extracts the bundled JavaScript from the `.pbiviz`, serves the harness on
loopback, and captures each scene over the Chrome DevTools Protocol at exactly
1366x768.

| File | Dimensions | Bytes | Shows |
| --- | --- | --- | --- |
| `assets/screenshots/01-grouped-distributions.png` | 1366x768 | 39,419 | Five production lines, Type 7 quartile boxes, Tukey whiskers, median, mean cross, outliers, and the row-count diagnostics line |
| `assets/screenshots/02-outliers-and-diagnostics.png` | 1366x768 | 34,596 | Tukey outliers, including the zero-IQR distribution where the repeated value is itself the fence |
| `assets/screenshots/03-selection-and-highlight.png` | 1366x768 | 49,956 | Report cross-highlighting and a live host-selection state produced by a real click on a distribution |

Byte counts are re-verified on every run of `npm run audit:submission`; the
committed sizes above are informational.

### Suggested listing copy

- **Category:** Data visualization / Analytics
- **Industries:** Manufacturing, Healthcare, Financial services, Education
- **Short pitch:** Truthful grouped distribution box plots for Power BI, with Type 7
  quartiles, Tukey whiskers, genuine outlier retention, and explicit row-count
  diagnostics.
- **Key differentiator:** The visual never claims data completeness. It reports
  received, rendered, invalid, and dropped rows, and it flags a full 30,000-row host
  window as potentially partial.

## 3. Compliance statements

| Topic | Statement |
| --- | --- |
| Privileges | `capabilities.json` declares `"privileges": []`. |
| Network access | None. `tests/package.test.ts` asserts the source contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, or `Function`. |
| Unsafe DOM APIs | None. The same test asserts no `innerHTML`, `outerHTML`, or `document.write`. |
| External assets | None. `pbiviz.json` sets `externalJS: null` and `dependencies: null`. |
| Localization | `stringResources/` ships `en-US`, `ar-SA`, `de-DE`, `es-ES`, and `fr-FR`, key-aligned by test. |
| Accessibility | Keyboard focus, high-contrast palette support, reduced motion, RTL, and an offscreen accessible summary table. |
| Certification status | **Not claimed.** This repository has not been certified or validated by Microsoft. |

## 4. Remaining manual, owner-controlled steps

These cannot be automated from this repository.

### 4.1 Save the offline sample report as `.pbix` (required by Microsoft)

Microsoft requires a sample report that works fully offline with no external
connections. This repository ships that report as a complete Power BI Desktop
**project** at `samples/AtlynSample.pbip`, generated deterministically
by `npm run sample-report` and validated by `npm run audit:submission` and the Jest
suite. It uses only the native, publicly documented PBIP folder format - no
third-party tooling is involved, and in particular nothing here depends on
`pbi-tools`, whose `compile` command is incompatible with current Power BI Desktop
packaging APIs.

A `.pbix` cannot be produced headlessly: its `DataModel` part is a binary Analysis
Services backup image. So the project is committed in the documented text formats
and the owner performs one manual save.

What is already in the project:

- **Report** in the documented PBIR format
  (`AtlynSample.Report/definition/**.json`), with the visual bound to
  `visualType: atlynDistributionA1B2C3D4E5F6G7H8I9J0` and `Category`, `Sample`, and
  `Value` each projected as a raw **Column** - the PBIR equivalent of *Don't
  summarize*, which this visual requires.
- **Semantic model** in TMDL
  (`AtlynSample.SemanticModel/definition/**.tmdl`) holding all 200 rows in a
  **DAX calculated table** (`partition Measurements = calculated` with a
  `DATATABLE(...)` source). A calculated table has no data source object at all -
  no Power Query partition, no shared expression, no `dataSources.tmdl` - so there
  is nothing to authenticate against and nothing to refresh.
- **The visual embedded as a private custom visual** under
  `AtlynSample.Report/CustomVisuals/`, declared through a `CustomVisual` entry in
  `resourcePackages`. `publicCustomVisuals` is deliberately not used, because it
  resolves the visual from the AppSource store and would make the report
  non-offline.

Steps:

1. In Power BI Desktop, go to **File > Options and settings > Options > Preview
   features** and enable **Power BI Project (.pbip) save option**, **Store reports
   using enhanced metadata format (PBIR)**, and **Store semantic model using TMDL
   format**.
2. Run `npm run package` and then `npm run sample-report` so the embedded visual
   matches the exact build you are submitting. (Both are already committed; re-run
   them only after a version bump.)
3. Open `samples/AtlynSample.pbip`.
4. Confirm the visual renders and the diagnostics line reports 200 received and 200
   rendered rows.
5. **File > Save As** and choose **Power BI files (\*.pbix)**. Save as
   `samples/AtlynSample.pbix` and commit it.
   `npm run audit:submission` will then report the sample report as present.

> **Verification status.** The project is generated against Microsoft's published
> PBIP, PBIR, and TMDL schemas and is checked structurally by
> `tests/sampleReport.test.ts` and `npm run audit:submission`. It has **not** been
> opened in Power BI Desktop from this repository's automation, because Desktop is
> Windows-desktop GUI software and is not launched by the build. Step 3 above is
> therefore also the real-world verification step.

> **Format versions.** `definition.pbir` uses `"version": "4.0"` and
> `definition.pbism` uses `"version": "4.2"` on purpose. Microsoft documents
> `"version": "1.0"` as selecting the *legacy* formats - PBIR-Legacy `report.json`
> for reports and TMSL `model.bim` for semantic models - which this project does
> not use. `4.0` or above is required for the `definition/` folder layout.

### 4.2 Partner Center account and listing

1. Confirm the Partner Center publisher account, publisher display name, and the
   tax and payout profile are complete.
2. Create the Power BI visual offer and upload the exact `.pbiviz` recorded in
   `dist/release-metadata.json`.
3. **Leave the offer FREE.** Do not set a price, a trial, or any transactability
   option - see the licensing subsection in section 2. Monetization is handled
   entirely by the Atlyn Stripe subscription at <https://atlyn.io> and is outside
   Partner Center.
4. Upload `assets/logo-300x300.png` as the logo and the three files in
   `assets/screenshots/` as the listing screenshots.
5. Paste the support URL <https://atlyn.io/contact> and the privacy policy URL
   <https://atlyn.io/legal/privacy>.
6. Attach `EULA.md` as the EULA, or select Microsoft's standard contract.
7. Upload the sample `.pbix` saved in section 4.1.
8. Submit for review.

### 4.3 Pre-submission link check

Re-confirm immediately before submitting that both URLs return HTTP 200:

- <https://atlyn.io/legal/privacy>
- <https://atlyn.io/contact>

`https://atlyn.io/privacy`, `https://atlyn.io/support`, and `https://atlyn.io/terms`
return 404 and must not be used.

## 5. Verification commands

```text
npm ci
npm test                      # includes the submission asset assertions
npm run typecheck
npm run eslint
npm run package
npm run package:reproducible
npm run release:metadata
npm run sample-report         # regenerates samples/ from the built .pbiviz
npm run icon                  # re-renders assets/icon.png at 20x20 from assets/icon.svg
npm run audit:submission      # deterministic AppSource asset gate
npm run certification-audit   # pbiviz certification audit + audit:submission
npm audit --audit-level=high
npm run screenshots           # re-captures assets/screenshots from the built visual
```

`npm run screenshots` needs a locally installed Chrome, Edge, or Chromium (or
`CHROME_PATH` pointing at one) and Node 22 or newer. It is intentionally not part
of CI; CI validates the committed PNGs instead.

`npm run sample-report` needs `npm run package` to have run first, because it
embeds the built `.pbiviz` into the project. `npm run audit:submission` regenerates
the project in memory and fails if `samples/` has drifted.
