import { describe, expect, it } from "vitest";
import { utf8ByteColumnToUtf16 } from "./positions";

describe("UTF-8 byte columns", () => {
  it.each([
    { line: "名前", bytes: 3, codeUnits: 1 },
    { line: "名前", bytes: 6, codeUnits: 2 },
    { line: '"😀".upc', bytes: 7, codeUnits: 5 },
    { line: '"😀".upc', bytes: 10, codeUnits: 8 },
    { line: "x😀名", bytes: 8, codeUnits: 4 },
  ])("maps $bytes bytes in $line to $codeUnits UTF-16 code units", ({ line, bytes, codeUnits }) => {
    expect(utf8ByteColumnToUtf16(line, bytes)).toBe(codeUnits);
  });
});
