# Quoteget

Send one STEP file to CNC quote vendors. While a run is in progress, each vendor logs a line when it finishes; then a summary table is printed.

Lead time is normalized as the vendor's quoted production lead time. For Hubs, this excludes shipping transit time.

```bash
npm install
npx playwright install chromium
npm run build
```

**All supported vendors** (Hubs, Xometry, RapidDirect, Protolabs):

```bash
node dist/cli.js all ./part.step
npm run quote:all -- ./part.step
```

**Default vendor set** (same as above except Protolabs is omitted):

```bash
node dist/cli.js run ./part.step
npm run quote:default -- ./part.step
```

**Specific vendors** (comma-separated):

```bash
node dist/cli.js run ./part.step --vendors hubs
node dist/cli.js run ./part.step --vendors hubs,xometry
```

Example terminal output when every vendor in an `all` run returns a quote (prices and lead times are illustrative):

```
Run 550e8400-e29b-41d4-a716-446655440000 started.
[hubs] running
[xometry] running
[rapiddirect] running
[protolabs] running
[hubs] quoted USD 42.50
[xometry] quoted USD 51.20
[rapiddirect] quoted USD 48.00
[protolabs] quoted USD 55.75
Run 550e8400-e29b-41d4-a716-446655440000 completed.

Vendor       Status                   Price          Lead Time            Material                 Error
hubs         quoted                   USD 42.50      Standard / 1-2 days  Aluminum 6061            -
xometry      quoted                   USD 51.20      5 business days      Aluminum 6061            -
rapiddirect  quoted                   USD 48.00      7 days               Aluminum 6061            -
protolabs    quoted                   USD 55.75      3 business days      Aluminum 6061            -
```

## Notes

- Supported material slugs today: `aluminum_6061`, `aluminum_7075`.
- Hubs uses a disposable email by default if `HUBS_EMAIL` is not set.
- Hubs lead time is taken from the quote's `lead_time` field and reported as business days, not from shipping options.
- RapidDirect still relies on the quote-detail follow-up flow after upload: configure the part, complete the user-details gate, then wait for the refreshed pricing cards.
- If `QUOTE_TOOL_SESSION_SECRET` is set, captured browser sessions are stored in encrypted bundles under `storage/sessions/`.
- Browserbase is optional, but it is the preferred runtime for the RapidDirect anonymous pilot.
- The tool stops at quote pages only. It does not place orders or reach checkout.
- Phase 1 is still intentionally narrow on process and quantity: CNC machining, quantity 1, STEP only.
