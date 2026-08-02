# Atlyn Distribution

Atlyn Distribution is a certification-first Power BI custom visual for grouped
raw-observation distributions. It requires `Category`, `Sample`, and `Value`
roles, calculates Hyndman-Fan Type 7 quartiles, and uses Tukey 1.5×IQR
inlier whiskers. Duplicate outlier observations are retained.

The raw-observation contract is deliberately bounded to the 30,000-row host
window. The visual reports received, rendered, and invalid row counts and
never claims population completeness. It also provides native host tooltips,
selection/context-menu integration, highlights, keyboard navigation, RTL and
high-contrast support, reduced-motion behavior, and an accessible summary
table.

## Development

```text
npm ci
npm test
npm run build
npm run lint
npm run package
npm audit
```

The package has no privileges, network access, external assets, or unsafe DOM
APIs. Microsoft certification and validation in a real Power BI host are not
claimed by this repository.
