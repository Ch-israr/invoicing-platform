import { describe, expect, it } from "vitest";
import { CsvParseError, headerIndex, parseCsv, toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("escapes commas, quotes and newlines", () => {
    const out = toCsv(["Name", "Notes"], [
      ["Acme, Ltd", 'Said "hello"\nthen left'],
      ["Plain", ""],
    ]);
    expect(out).toBe(
      'Name,Notes\r\n"Acme, Ltd","Said ""hello""\nthen left"\r\nPlain,\r\n',
    );
  });
});

describe("parseCsv", () => {
  it("parses a plain file", () => {
    expect(parseCsv("Name,Price\nWidget,10.50\nGadget,2\n")).toEqual([
      ["Name", "Price"],
      ["Widget", "10.50"],
      ["Gadget", "2"],
    ]);
  });

  it("handles quoted fields with commas, newlines and escaped quotes", () => {
    expect(parseCsv('Name,Notes\n"Acme, Ltd","line one\nline ""two"""\n')).toEqual([
      ["Name", "Notes"],
      ["Acme, Ltd", 'line one\nline "two"'],
    ]);
  });

  it("handles CRLF and a UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFA,B\r\n1,2\r\n3,4")).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("A,B\n\n1,2\n\n")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("throws on unbalanced quotes", () => {
    expect(() => parseCsv('A,B\n"unclosed,2\n')).toThrow(CsvParseError);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["Name", "Notes"],
      ["Acme, Ltd", 'He said "hi"'],
      ["Multi\nline", "plain"],
    ];
    expect(parseCsv(toCsv(rows[0], rows.slice(1)))).toEqual(rows);
  });
});

describe("headerIndex", () => {
  it("is case-insensitive and trims", () => {
    const map = headerIndex([" Name ", "PRICE", "sku"]);
    expect(map.get("name")).toBe(0);
    expect(map.get("price")).toBe(1);
    expect(map.get("sku")).toBe(2);
    expect(map.get("missing")).toBeUndefined();
  });
});
