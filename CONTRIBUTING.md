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
npm audit
npm run certification-audit
```

Keep the stable visual GUID, privileges, and no-network design unchanged
unless the change is explicitly reviewed. Do not claim Microsoft certification
or live Power BI host validation from local tests.
