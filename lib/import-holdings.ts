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

const HEADER_HINT = /company|stock|name|instrument|symbol|ticker|scrip|isin|security/i;
const SYMBOL_COL = /symbol|ticker|scrip/i;
const NAME_COL = /company|stock name|instrument|security|name/i;
const ISIN_COL = /isin/i;
const SKIP = /^(total|grand total|holdings|portfolio)?$/i;

export function extractCandidates(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const looksCsv = lines[0].includes(",");
  if (!looksCsv) {
    // Plain list: one symbol/name per line (or comma separated on one line).
    return dedupeCap(
      lines
        .flatMap((l) => l.split(","))
        .map((s) => s.trim())
        .filter((s) => s && !SKIP.test(s))
    );
  }

  const rows = lines.map(parseLine);
  const header = rows[0];
  const hasHeader = header.some((h) => HEADER_HINT.test(h));

  let col = 0;
  let dataRows = rows;
  if (hasHeader) {
    const find = (re: RegExp) => header.findIndex((h) => re.test(h));
    col = find(SYMBOL_COL);
    if (col < 0) col = find(NAME_COL);
    if (col < 0) col = find(ISIN_COL);
    if (col < 0) col = 0;
    dataRows = rows.slice(1);
  }

  return dedupeCap(
    dataRows
      .map((r) => (r[col] ?? "").trim())
      .filter((v) => v && !SKIP.test(v))
  );
}

function dedupeCap(arr: string[], cap = 100): string[] {
  return [...new Set(arr)].slice(0, cap);
}
