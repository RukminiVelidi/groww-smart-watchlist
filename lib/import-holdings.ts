// Extract candidate company names / symbols from a broker export (CSV) or a
// pasted list. Broker exports (Groww, etc.) vary in columns, so we detect the
// most likely column heuristically rather than assume one fixed format. The
// candidates are then resolved to NSE symbols (see resolve.ts).

// Minimal CSV line parser that respects double-quoted fields.
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const HEADER_HINT = /stock name|company|instrument|scrip|security|symbol|ticker|isin/i;
const SYMBOL_COL = /symbol|ticker|scrip/i;
const NAME_COL = /stock name|company|instrument|security|name/i;
const ISIN_COL = /isin/i;
const SKIP = /^(total|grand total|holdings|portfolio|summary)?$/i;
const NUMERIC = /^[₹$]?[\d,]+(\.\d+)?%?$/; // pure numbers/amounts aren't stock names

export function extractCandidates(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const looksCsv = lines.some((l) => l.includes(","));
  if (!looksCsv) {
    // Plain list: one symbol/name per line (or comma separated on one line).
    return dedupeCap(cleanValues(lines.flatMap((l) => l.split(","))));
  }

  const rows = lines.map(parseLine);

  // Broker exports (Groww etc.) put metadata rows ABOVE the real header, so we
  // find the header row anywhere — the first multi-column row that names a
  // stock/symbol/ISIN column — rather than assuming it's row 0.
  const headerIdx = rows.findIndex(
    (r) => r.length >= 2 && r.some((c) => HEADER_HINT.test(c))
  );

  if (headerIdx >= 0) {
    const header = rows[headerIdx];
    const find = (re: RegExp) => header.findIndex((h) => re.test(h));
    let col = find(SYMBOL_COL);
    if (col < 0) col = find(NAME_COL);
    if (col < 0) col = find(ISIN_COL);
    if (col < 0) col = 0;
    return dedupeCap(cleanValues(rows.slice(headerIdx + 1).map((r) => r[col] ?? "")));
  }

  // No header found — take the first column of each row.
  return dedupeCap(cleanValues(rows.map((r) => r[0] ?? "")));
}

function cleanValues(vals: string[]): string[] {
  return vals
    .map((s) => s.trim())
    .filter((s) => s && !SKIP.test(s) && !NUMERIC.test(s));
}

function dedupeCap(arr: string[], cap = 100): string[] {
  return [...new Set(arr)].slice(0, cap);
}
