/** Converts a Ruby LSP UTF-8 byte column to Monaco's UTF-16 code-unit column. */
export function utf8ByteColumnToUtf16(line: string, byteColumn: number): number {
  let bytes = 0;
  let codeUnits = 0;
  for (const character of line) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (bytes + characterBytes > byteColumn) break;
    bytes += characterBytes;
    codeUnits += character.length;
  }
  return codeUnits;
}
