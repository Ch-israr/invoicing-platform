/**
 * Minimal CSV helpers (no dependency).
 * - toCsv: builds a CSV string from header + rows, escaping per RFC 4180.
 * - parseCsv: parses CSV text into rows of string cells. Handles quoted
 *   fields, escaped quotes (""), commas/newlines inside quotes, CRLF.
 * Throws CsvParseError on unbalanced quotes.
 */

export class CsvParseError extends Error {}

function escapeCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Parse CSV text into rows. The first row is the header row. */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM if present (Excel writes one).
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      if (fieldStarted && field.length > 0) {
        throw new CsvParseError(
          `Unexpected quote at character ${i} — quotes must start a field`,
        );
      }
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (ch === "\n" || ch === "\r") {
      // CRLF counts as one line break.
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      fieldStarted = false;
      // Skip a single trailing empty line at end of file.
      if (!(row.length === 1 && row[0] === "" && i === input.length - 1)) {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
      fieldStarted = true;
    }
  }

  if (inQuotes) {
    throw new CsvParseError("Unbalanced quotes — a quoted field was never closed");
  }
  // Last line without a trailing newline.
  if (field.length > 0 || fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty rows (blank lines) — they are not data.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Map header names (case-insensitive, trimmed) to column indexes. */
export function headerIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}
