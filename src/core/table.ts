import type { QuoteRunResult } from "./types.js";

export function renderQuoteTable(run: QuoteRunResult): string {
  const lines = [
    [
      "Vendor".padEnd(12),
      "Status".padEnd(24),
      "Price".padEnd(14),
      "Lead Time".padEnd(20),
      "Material".padEnd(24),
      "Error",
    ].join(" "),
  ];

  for (const result of run.results) {
    const price =
      result.price !== undefined && result.currency
        ? `${result.currency} ${result.price.toFixed(2)}`
        : "-";

    lines.push(
      [
        result.vendor.padEnd(12),
        result.status.padEnd(24),
        price.padEnd(14),
        (result.leadTime ?? "-").padEnd(20),
        (result.material ?? "-").padEnd(24),
        result.error ?? "-",
      ].join(" "),
    );
  }

  return lines.join("\n");
}
