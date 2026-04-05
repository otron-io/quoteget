# Quoteget

Send one STEP file to CNC quote vendors and print a summary table.

```bash
npm install
npx playwright install chromium
npm run build
```

**All vendors** (Hubs, Xometry, RapidDirect, Protolabs):

```bash
node dist/cli.js ./part.step --material aluminum_6061 --quantity 1
```

**Specific vendors** (comma-separated):

```bash
node dist/cli.js ./part.step --vendors hubs
node dist/cli.js ./part.step --vendors hubs,xometry
```

Example terminal output when every vendor returns a quote:

```
Vendor       Status                   Price          Lead Time            Material                 Error
hubs         quoted                   USD 42.50      Standard / 1–2 days  Aluminum 6061            -
xometry      quoted                   USD 51.20      5 business days      Aluminum 6061            -
rapiddirect  quoted                   USD 48.00      7 days               Aluminum 6061            -
protolabs    quoted                   USD 55.75      3 business days      Aluminum 6061            -
```

(Prices and lead times are illustrative; real output depends on each vendor.)
