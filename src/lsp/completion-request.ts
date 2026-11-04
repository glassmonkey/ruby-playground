export type CompletionSnapshot<Position extends { lineNumber: number; column: number }> = {
  text: string;
  version: number;
  position: Position;
};

export async function requestForStableSnapshot<
  T,
  Position extends { lineNumber: number; column: number },
>(
  getSnapshot: () => CompletionSnapshot<Position> | undefined,
  request: (snapshot: CompletionSnapshot<Position>) => Promise<T>,
  isActive: () => boolean,
): Promise<{ snapshot: CompletionSnapshot<Position>; value: T } | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isActive()) return undefined;
    const snapshot = getSnapshot();
    if (!snapshot) return undefined;

    const value = await request(snapshot);
    if (!isActive()) return undefined;
    const latest = getSnapshot();
    if (!latest) return undefined;
    if (sameSnapshot(snapshot, latest)) return { snapshot, value };
  }
  return undefined;
}

function sameSnapshot<Position extends { lineNumber: number; column: number }>(
  left: CompletionSnapshot<Position>,
  right: CompletionSnapshot<Position>,
) {
  return (
    left.version === right.version &&
    left.position.lineNumber === right.position.lineNumber &&
    left.position.column === right.position.column
  );
}
