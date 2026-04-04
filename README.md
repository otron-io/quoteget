# Quoteget

Quoteget is a local-first quoting tool for Atlas.

You give it one STEP file, `aluminum_6061`, and `quantity=1`. It sends that exact file to Hubs, Xometry, RapidDirect, and Protolabs, then returns what each vendor actually says: quoted, manual review required, failed, or not supported.

## Quick Start

```bash
npm install
npx playwright install chromium
npm run build
node dist/cli.js ./part.step --material aluminum_6061 --quantity 1
node dist/cli.js serve
```

If you want the `quote` shell command locally, run:

```bash
npm link
quote ./part.step --material aluminum_6061 --quantity 1
quote serve
```

## Browser Vendor Setup

Xometry, RapidDirect, and Protolabs require stored authenticated Playwright sessions.

Capture them once:

```bash
node dist/cli.js auth capture --vendor xometry
node dist/cli.js auth capture --vendor rapiddirect
node dist/cli.js auth capture --vendor protolabs
```

Then verify them:

```bash
node dist/cli.js doctor
```

## Notes

- Hubs uses a disposable email by default if `HUBS_EMAIL` is not set.
- The tool stops at quote pages only. It does not place orders or reach checkout.
- Phase 1 is intentionally narrow: CNC machining, Aluminum 6061, quantity 1, STEP only.
