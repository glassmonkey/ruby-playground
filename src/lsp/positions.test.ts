import { describe, expect, it } from "vitest";
import {
  rebaseCompletionEndColumn,
  utf8ByteColumnToUtf16,
} from "./positions";

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

describe("async completion range rebasing", () => {
  it.each([
    { end: 17, requested: 14, response: 17, want: 14 },
    { end: 19, requested: 14, response: 17, want: 16 },
    { end: 17, requested: 16, response: 17, want: 16 },
  ])(
    "moves end $end from response column $response to request column $requested",
    ({ end, requested, response, want }) => {
      expect(rebaseCompletionEndColumn(end, requested, response)).toBe(want);
    },
  );

  it("converts UTF-8 edit offsets before rebasing Monaco columns", () => {
    const line = 'puts "😀".upc + "!"';
    const rawEndByteColumn = new TextEncoder().encode('puts "😀".upc').length;
    const responseColumn = 'puts "😀".upc'.length + 1;
    const requestedColumn = 'puts "😀".'.length + 1;
    const monacoEndColumn = utf8ByteColumnToUtf16(line, rawEndByteColumn) + 1;

    expect(
      rebaseCompletionEndColumn(
        monacoEndColumn,
        requestedColumn,
        responseColumn,
      ),
    ).toBe(requestedColumn);
  });
});
