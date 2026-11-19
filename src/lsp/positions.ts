/** Converts an LSP UTF-8 byte column to Monaco's UTF-16 code-unit column. */
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

/**
 * Monaco inserts relative to the provider's original cursor even when an async
 * result was requested again after the cursor moved. Rebase the LSP range end
 * from the response cursor to that original cursor before returning the item.
 */
export function rebaseCompletionEndColumn(
  endColumn: number,
  requestedColumn: number,
  responseColumn: number,
): number {
  return endColumn - (responseColumn - requestedColumn);
}
