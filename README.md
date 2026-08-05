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
npm run layout-probe
npm run layout-selftest
npm run prove-regressions
npm run release:metadata
npm audit
npm run audit:submission
npm run certification-audit
```

## Layout probe

A Power BI custom visual renders inside a host tile with `overflow: hidden`. Content
pushed outside that tile is silently clipped: it does not scroll, and nothing tells the
report author that anything is missing. Unit tests cannot see this. JSDOM has no layout
engine, so `getBoundingClientRect()` returns zero for everything and a geometry
assertion written against it is not weak but *vacuous* - it can never fail.

`npm run layout-probe` therefore packages the visual, extracts the bundle the host
actually executes out of the `.pbiviz`, and renders it in real headless Chromium across
80 cases: five tile sizes (1280x620, 398x298, 258x198, 178x138, 80x80) crossed with the
formatting toggles in their default and non-default states, both writing directions, high
contrast, and nine data scenarios including long labels, twelve narrow categories, the
cross-highlight path and the empty and invalid states. Every element under the visual
root is measured against the root's box. Three exemptions apply, each reported rather
than hidden: descendants of a real scroll container, anything not painted at all, and
anything clipped to zero area by `clip-path` - the screen-reader-only idiom, which this
visual needs because `overflow` is inert on a `display: table` box. The elements allowed
to claim that last exemption are pinned, so it cannot grow into a place where defects
hide.

`npm run prove-regressions` reverts each layout fix in turn, repackages, and requires the
probe to go red on the cases that fix governs. A fix that cannot be shown to fail without
its patch is not proven, and this script fails if one stays green.

### Positioning, scroll and sticky

Every probe case also reports a positioning triage, because two whole defect classes are
cheap to rule out and expensive to discover late:

- an **absolutely positioned child of a `position: static` root** resolves against the
  *initial containing block*. It escapes the root's `overflow: hidden` entirely and belongs
  to the page rather than the visual, which an overflow walk scoped to the root cannot see,
  because the element is no longer laid out relative to it at all.
- **`position: sticky` inside a scrolling region** is the header-pinning bug: headers pin
  to the same offset and collapse onto one another. At rest they lay out normally and look
  perfect, so no at-rest assertion can catch it.

Atlyn Distribution has neither. The root is set to `position: relative` unconditionally in
the constructor, all 224 absolutely positioned elements across the matrix resolve to it,
and there is no `position: sticky`, no `position: fixed` and no scroll container anywhere -
the root sets `overflow: hidden`, the chart is an SVG scaled to the viewport, and the
accessible summary table is hidden with `clip-path` rather than put in a scrolling panel.
The probe prints those counts on every run rather than asserting cleanliness, so the claim
stays checkable.

Because those rules therefore never fire against the real visual, `npm run layout-selftest`
points each one at a DOM built specifically to break it, in the same real Chromium, and
requires it to produce the failure it exists to produce. Two of the seven fixtures are
healthy rather than broken: a rule that also fires on correct layout would be as worthless
as one that never fires. The rules themselves live in `tools/layout/rules.js` as pure
functions over plain measurements, and `tests/layoutRules.test.ts` drives them with
deliberately bad numbers - collapsed headers, regions that stopped scrolling, z-index read
out of a stacking context that does not exist.

The scroll walk is driven from Node: it picks each region's offsets with the same
unit-tested `scrollOffsetsFor`, scrolls the region, and re-runs the full escape walk and
the sticky measurement at every stop. The expected-region list is currently empty, which is
a declared contract rather than a skip - `evaluateScrollExpectations` fails on any region
nobody declared, so the day a scrollable panel is added the probe stops and asks for its
scroll-time contract instead of quietly finding a container it never scrolls.

Both run in CI on every push, on Node 22 - the probe drives Chrome over the DevTools
Protocol using the global `WebSocket`, which is only unflagged from Node 22. The runner
resolves its own font files rather than replaying a local measurement: the visual sets no
`font-family` on its SVG text, so it renders in the browser's default serif, Times New
Roman on Windows and a metric-compatible substitute on Linux. The measurements agree
across the two because those substitutes are metric-compatible by design, not because
anything is being replayed.

## Release artifacts

`npm run package` and `npm run certification-audit` normalize the generated
PBIVIZ ZIP entry order, timestamps, permissions, platform, and compression
before atomically replacing the artifact. Stale `dist` PBIVIZ files are
removed, and exactly one package matching the generated manifest is required.
The reproducibility gate packages twice from the same source and requires the
exact filename, byte count, and SHA-256 to match. `.gitattributes` pins the line
endings of every text asset that gets read into the package (`*.svg`, `*.resjson`),
so the artifact is byte-identical on Windows and Linux rather than only
reproducible per operating system. A release manifest must
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
version, description, https support URL, author name and email), and asserts all
three image contracts separately: `assets/icon.png` is a real PNG at exactly
20x20, `assets/logo-300x300.png` at exactly 300x300, and `assets/screenshots`
holds one to five PNGs at exactly 1366x768 and at most 1024 KB each. It also
checks that the EULA and dossier are present and cross-linked, and that
`assets/sample-data/atlyn-distribution-sample.csv` still
matches its deterministic generator. It also reports whether the sample `.pbix`
is present; Microsoft requires one, but only Power BI Desktop can author it, so
that step stays with the owner and is never faked here.

`npm run icon` re-renders `assets/icon.png` from `assets/icon.svg` at exactly
20x20 in a headless browser. Microsoft documents the packaged visual icon as a PNG
at 20x20, but `powerbi-visuals-tools` does not enforce it: it embeds whatever
`assets.icon` points at and hard-codes `assets/icon.png` into the packaged
manifest either way, so an SVG source silently produces a manifest/payload
mismatch. The SVG stays the editable source; the PNG is what ships.

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

## Offline sample report

Microsoft requires a sample report that works fully offline. `samples/` holds that
report as a complete Power BI Desktop project: `AtlynSample.pbip`, a PBIR report
definition, and a TMDL semantic model that holds all 200 rows in a **DAX
calculated table** (`DATATABLE(...)`). A calculated table has no data source
object at all - no Power Query partition, no shared expression, no
`dataSources.tmdl` - so there is nothing to authenticate against and nothing to
refresh. The visual is embedded as a private custom visual under
`CustomVisuals/`, declared through a `CustomVisual` resource package rather than
`publicCustomVisuals`, so nothing is resolved from the AppSource store at render
time.

The project uses only the native, publicly documented PBIP folder format; no
third-party packaging tool is involved.

`npm run sample-report` regenerates the whole project deterministically from the
built `.pbiviz`, and `npm run audit:submission` regenerates it in memory and fails
if the committed tree has drifted. `tests/sampleReport.test.ts` additionally
asserts that the visual binds the frozen GUID, that every `queryState` key is a
declared `capabilities.json` data role, that no projection is aggregated, and that
the semantic model contains no Power Query partition, shared expression, or data
source declaration.

The embedded bundle is always the plain `npm run package` output, which is the
artifact recorded in `dist/release-metadata.json` and uploaded to Partner Center.
`pbiviz package --certification-audit` emits a beautified copy of the same bundle
for human review, so `npm run certification-audit` repackages normally before
auditing to keep `dist/` holding the shipping artifact.

A `.pbix` cannot be produced headlessly, because its `DataModel` part is a binary
Analysis Services backup image. The project is generated against Microsoft's
published PBIP, PBIR, and TMDL schemas and validated structurally, but it has not
been opened in Power BI Desktop by this repository's automation. Converting it to
`.pbix` is one manual **Save As** in Desktop; see section 4.1 of
`docs/partner-center-submission.md`.

The package has no privileges, network access, external assets, or unsafe DOM
APIs. Microsoft certification and validation in a real Power BI host are not
claimed by this repository. The visual also respects the host's
`allowInteractions` capability and caps rendered point markers per
distribution to keep large bounded data windows responsive.
