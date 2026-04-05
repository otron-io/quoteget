# Quoteget

Quoteget is a local-first quoting tool for Atlas.

You give it one STEP file, `aluminum_6061`, and `quantity=1`. It sends that exact file to Hubs, Xometry, RapidDirect, and Protolabs, then returns what each vendor actually says: quoted, manual review required, failed, or not supported.

## Demo

Terminal capture of a CLI run against **Hubs** using the sample part [`demo-part.step`](demo-part.step) (10 mm cube STEP). The command in the recording is `node dist/cli.js ./demo-part.step --vendors hubs --json` (JSON output pretty-printed).

<video controls muted playsinline width="100%">
  <source src="docs/demo-quote.mp4" type="video/mp4" />
</video>

The Hubs integration **refreshes JWT access tokens** during long quote polling (same anonymous session), so multi-minute quotes stay reliable.

In your clone you can play the file directly: [`docs/demo-quote.mp4`](docs/demo-quote.mp4).

Re-record on Linux (needs `xterm`, `xvfb`, `ffmpeg`; see script for details):

```bash
npm run build
./scripts/record-demo-x11.sh
```

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

If `./storage/auth/*.json` files are **missing**, the tool creates disposable accounts for **Xometry** and **RapidDirect** in the browser. **Protolabs** still needs either a saved session or `TWOCAPTCHA_API_KEY` for automatic signup (reCAPTCHA on their registration page).

You can still capture long-lived sessions once:

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
