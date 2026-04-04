# Quoteget

CNC machining quote aggregation tool. Accepts a STEP file and submits it to four vendors (Hubs, Xometry, RapidDirect, Protolabs), then returns normalized results.

## Cursor Cloud specific instructions

### Prerequisites

- Node.js >= 24.14.1 (use `nvm use 24` if needed)
- Playwright Chromium must be installed: `npx playwright install chromium`
- Copy `.env.example` to `.env` for local config (defaults work for dev/test)

### Key commands

See `package.json` scripts for the full list. Quick reference:

| Action | Command |
|--------|---------|
| Install deps | `npm install` |
| Build | `npm run build` (compiles `src/` → `dist/` via tsc) |
| Dev mode (no build) | `npm run dev` (uses tsx) |
| Run tests | `npm test` (vitest, all vendors are stubbed — no network needed) |
| Start web server | `node dist/cli.js serve` (port 4310) |
| CLI quote | `node dist/cli.js ./part.step --material aluminum_6061 --quantity 1` |

### Notes

- No dedicated lint script. `npm run build` (tsc) serves as the type checker.
- Tests run fully offline with stubs — no vendor credentials or network access required.
- The web server (`serve`) listens on port 4310 by default (configurable via `QUOTE_TOOL_PORT` in `.env`).
- Vendor auth sessions (Xometry, RapidDirect, Protolabs) are optional for dev/test. Only needed for live end-to-end quoting against real vendor APIs.
- `artifacts/` and `storage/` directories are created automatically at runtime.
