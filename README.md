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
npm audit
npm run certification-audit
```

The package has no privileges, network access, external assets, or unsafe DOM
APIs. Microsoft certification and validation in a real Power BI host are not
claimed by this repository. The visual also respects the host's
`allowInteractions` capability and caps rendered point markers per
distribution to keep large bounded data windows responsive.
