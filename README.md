# Quoteget

Quoteget is a local-first quoting tool for Atlas.

You give it one STEP file, a supported material slug, and `quantity=1`. It sends that exact file to Hubs, Xometry, RapidDirect, and Protolabs, then returns what each vendor actually says: quoted, manual review required, auth required, failed, or not supported.

## Demo

Screen recording of a real CLI run against **Hubs** using the committed sample part [`demo-part.step`](demo-part.step) (10 mm cube STEP).

<video controls muted playsinline width="100%">
  <source src="docs/demo-quote.mp4" type="video/mp4" />
</video>

After this recording was made, the Hubs client was updated to **refresh JWT access tokens** during long quote polling (same anonymous session), so multi-minute quotes stay reliable.

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
npm run quote:default -- ./part.step
node dist/cli.js ./part.step --material aluminum_6061 --quantity 1 --vendors hubs
node dist/cli.js ./part.step --material aluminum_7075 --quantity 1 --vendors hubs,rapiddirect
node dist/cli.js serve
```

If you want the `quote` shell command locally, run:

```bash
npm link
quote ./part.step --material aluminum_6061 --quantity 1
quote all ./part.step
quote serve
```

The default one-command flow excludes Protolabs and runs:
```bash
npm run build
npm run quote:default -- ./part.step
```

If you linked the CLI globally, the same default flow is:

```bash
quote ./part.step
```

If you want the full vendor sweep, including Protolabs, run:

```bash
npm run quote:all -- ./part.step
quote all ./part.step
```

If `./storage/auth/*.json` files are missing, the tool creates disposable accounts for Xometry and RapidDirect in the browser. Protolabs still needs either a saved session or `TWOCAPTCHA_API_KEY` for automatic signup because its registration flow is gated by reCAPTCHA.

## Benchmark Candidate

Current benchmark fixture: `./fixtures/one_cm_cube.step`

Source: [MattFerraro/1cm cube.step gist](https://gist.github.com/MattFerraro/76adbd74042696895e7f9b0f87313a88)

As of April 5, 2026, this is the strongest demo part in the repo:

- `hubs`: quoted
- `xometry`: quoted
- `protolabs`: quoted
- `rapiddirect`: quoted after the user-details gate is completed

Run it with:

```bash
node dist/cli.js run ./fixtures/one_cm_cube.step --vendors hubs,xometry,rapiddirect,protolabs
```

## Current Vendor Status

- `Hubs` is the live working baseline today.
- `RapidDirect` is the active anonymous-first pilot. If Browserbase is configured, Quoteget can probe whether unattended anonymous quoting is viable from a fresh environment.
- `Xometry` still relies on a stored authenticated browser session.
- `Protolabs` is supported, but it is not part of the default vendor set because its captcha is too aggressive for unattended runs.

## Browser Vendor Setup

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

- Supported material slugs today: `aluminum_6061`, `aluminum_7075`.
- Hubs uses a disposable email by default if `HUBS_EMAIL` is not set.
- RapidDirect still relies on the quote-detail follow-up flow after upload: configure the part, complete the user-details gate, then wait for the refreshed pricing cards.
- If `QUOTE_TOOL_SESSION_SECRET` is set, captured browser sessions are stored in encrypted bundles under `storage/sessions/`.
- Browserbase is optional, but it is the preferred runtime for the RapidDirect anonymous pilot.
- The tool stops at quote pages only. It does not place orders or reach checkout.
- Phase 1 is still intentionally narrow on process and quantity: CNC machining, quantity 1, STEP only.
