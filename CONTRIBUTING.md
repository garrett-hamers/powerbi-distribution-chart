# Contributing

## Development

Use the locked toolchain and run the release checks before opening a pull
request:

```text
npm ci
npm test
npm run typecheck
npm run eslint
npm run package
npm run release:metadata
npm audit
npm run certification-audit
```

Package commands normalize PBIVIZ ZIP timestamps and reject stale or multiple
artifacts. For release, record the final main commit, exact package filename,
SHA-256, Node/npm versions, and `powerbi-visuals-tools` version in the release
manifest, then publish that exact package without regenerating it.
Run `npm run release:metadata` after packaging to generate
`dist/release-metadata.json` and enforce the checked-in 300x300 Partner Center
logo contract.

Keep the stable visual GUID, privileges, and no-network design unchanged
unless the change is explicitly reviewed. Do not claim Microsoft certification
or live Power BI host validation from local tests.
