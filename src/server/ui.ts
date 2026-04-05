import { DEFAULT_MATERIAL, listMaterialDefinitions } from "../core/materials.js";
import { DEFAULT_VENDORS, SUPPORTED_VENDORS, type QuoteRunResult, type VendorName } from "../core/types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderRunFragment(run: QuoteRunResult): string {
  const resultByVendor = new Map(run.results.map((result) => [result.vendor, result] as const));
  const rows = run.request.vendors
    .map((vendor) => {
      const result = resultByVendor.get(vendor);
      const status = result?.status ?? (run.status === "pending" || run.status === "running" ? "running" : "-");
      const price = result?.price !== undefined && result.currency
        ? `${result.currency} ${result.price.toFixed(2)}`
        : "-";

      return `
        <tr>
          <td>${escapeHtml(vendor)}</td>
          <td>${escapeHtml(status)}</td>
          <td>${escapeHtml(price)}</td>
          <td>${result?.leadTime ? escapeHtml(result.leadTime) : "-"}</td>
          <td>${result?.material ? escapeHtml(result.material) : "-"}</td>
          <td>${result?.error ? escapeHtml(result.error) : "-"}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="run-fragment">
      <div class="run-meta">
        <strong>Run:</strong> ${escapeHtml(run.runId)}
        <strong>Status:</strong> ${escapeHtml(run.status)}
      </div>
      <table>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Status</th>
            <th>Price</th>
            <th>Lead Time</th>
            <th>Material</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

export function renderAppPage(): string {
  const defaultVendors = new Set<VendorName>(DEFAULT_VENDORS);
  const materialOptions = listMaterialDefinitions()
    .map((material) => {
      const selected = material.slug === DEFAULT_MATERIAL ? " selected" : "";
      return `<option value="${escapeHtml(material.slug)}"${selected}>${escapeHtml(material.label)}</option>`;
    })
    .join("");
  const vendorCheckboxes = SUPPORTED_VENDORS.map((vendor) => {
    const label = formatVendorLabel(vendor);
    const checked = defaultVendors.has(vendor) ? " checked" : "";
    return `<label><input type="checkbox" name="vendors" value="${escapeHtml(vendor)}"${checked} /> ${escapeHtml(label)}</label>`;
  }).join("");

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Quoting Tool</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #f2efe8;
            --panel: #fffdf8;
            --ink: #1f1c18;
            --muted: #6e665d;
            --line: #d7cfc2;
            --accent: #a64b2a;
          }
          body {
            margin: 0;
            font-family: Georgia, "Times New Roman", serif;
            background: radial-gradient(circle at top, #fff8ee, var(--bg) 55%);
            color: var(--ink);
          }
          main {
            max-width: 960px;
            margin: 0 auto;
            padding: 32px 20px 60px;
          }
          .panel {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 14px 40px rgba(31, 28, 24, 0.08);
          }
          h1 {
            margin: 0 0 12px;
            font-size: clamp(2rem, 5vw, 3.4rem);
            line-height: 0.95;
            letter-spacing: -0.04em;
          }
          p {
            color: var(--muted);
            max-width: 64ch;
          }
          form {
            display: grid;
            gap: 16px;
            margin-top: 24px;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
          }
          label {
            display: grid;
            gap: 6px;
            font-size: 0.95rem;
          }
          input, select, button {
            font: inherit;
          }
          input[type="text"], input[type="number"], input[type="file"], select {
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 12px 14px;
            background: white;
          }
          .vendors {
            display: flex;
            flex-wrap: wrap;
            gap: 14px;
          }
          .vendors label {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          button {
            width: fit-content;
            padding: 12px 18px;
            border: none;
            border-radius: 999px;
            background: var(--accent);
            color: white;
            cursor: pointer;
          }
          #status {
            margin-top: 20px;
            min-height: 20px;
            color: var(--muted);
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            text-align: left;
            padding: 10px 8px;
            border-bottom: 1px solid var(--line);
            vertical-align: top;
          }
          .run-meta {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <main>
          <section class="panel">
            <h1>One STEP file. Four vendor outcomes.</h1>
            <p>The local UI calls the same backend as the CLI. Results are reported as real vendor states: quoted, manual review required, auth required, failed, or not supported.</p>
            <form id="quote-form">
              <label>
                STEP file
                <input id="file" name="file" type="file" accept=".step,.stp" required />
              </label>
              <div class="grid">
                <label>
                  Material
                  <select name="material">
                    ${materialOptions}
                  </select>
                </label>
                <label>
                  Quantity
                  <select name="quantity">
                    <option value="1" selected>1</option>
                  </select>
                </label>
              </div>
              <div class="vendors">
                ${vendorCheckboxes}
              </div>
              <button type="submit">Get Quotes</button>
            </form>
            <div id="status"></div>
            <div id="results"></div>
          </section>
        </main>
        <script>
          const form = document.getElementById("quote-form");
          const status = document.getElementById("status");
          const results = document.getElementById("results");

          async function poll(runId) {
            const response = await fetch('/api/runs/' + runId + '?view=fragment');
            if (!response.ok) {
              status.textContent = 'Failed to load run status.';
              return;
            }
            results.innerHTML = await response.text();

            const jsonResponse = await fetch('/api/runs/' + runId);
            if (!jsonResponse.ok) {
              return;
            }
            const run = await jsonResponse.json();
            status.textContent = 'Run status: ' + run.status;
            if (run.status === 'pending' || run.status === 'running') {
              window.setTimeout(() => poll(runId), 1000);
            }
          }

          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const vendorValues = Array.from(form.querySelectorAll('input[name="vendors"]:checked')).map((input) => input.value);
            formData.delete('vendors');
            formData.append('vendors', vendorValues.join(','));

            status.textContent = 'Submitting quote run...';
            results.innerHTML = '';

            const response = await fetch('/api/quotes', {
              method: 'POST',
              body: formData,
            });

            if (!response.ok) {
              status.textContent = 'Quote submission failed.';
              return;
            }

            const payload = await response.json();
            status.textContent = 'Run submitted. Polling...';
            poll(payload.runId);
          });
        </script>
      </body>
    </html>
  `;
}

function formatVendorLabel(vendor: VendorName): string {
  switch (vendor) {
    case "hubs":
      return "Hubs";
    case "xometry":
      return "Xometry";
    case "rapiddirect":
      return "RapidDirect";
    case "protolabs":
      return "Protolabs";
  }
}
