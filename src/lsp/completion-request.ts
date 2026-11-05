export type CompletionSnapshot<
  Position extends { lineNumber: number; column: number },
> = {
  text: string;
  version: number;
  position: Position;
};

export const COMPLETION_SNAPSHOT_BUDGET_MS = 8_000;
export const COMPLETION_SNAPSHOT_SETTLE_MS = 250;
const SNAPSHOT_POLL_INTERVAL_MS = 25;

export async function requestForStableSnapshot<
  T,
  Position extends { lineNumber: number; column: number },
>(
  getSnapshot: () => CompletionSnapshot<Position> | undefined,
  request: (snapshot: CompletionSnapshot<Position>) => Promise<T>,
  isActive: () => boolean,
): Promise<{ snapshot: CompletionSnapshot<Position>; value: T } | undefined> {
  const deadline = Date.now() + COMPLETION_SNAPSHOT_BUDGET_MS;
  let snapshot = getSnapshot();

  while (Date.now() < deadline) {
    if (!isActive() || !snapshot) return undefined;

    const response = await raceUntilDeadline(request(snapshot), deadline);
    if (response.timedOut || !isActive()) return undefined;

    const latest = getSnapshot();
    if (!latest) return undefined;
    if (sameSnapshot(snapshot, latest))
      return { snapshot, value: response.value };

    snapshot = await waitForStableSnapshot(
      getSnapshot,
      isActive,
      latest,
      deadline,
    );
  }
  return undefined;
}

async function waitForStableSnapshot<
  Position extends { lineNumber: number; column: number },
>(
  getSnapshot: () => CompletionSnapshot<Position> | undefined,
  isActive: () => boolean,
  initial: CompletionSnapshot<Position>,
  deadline: number,
): Promise<CompletionSnapshot<Position> | undefined> {
  let snapshot = initial;
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    if (!isActive()) return undefined;
    const delayMs = Math.min(SNAPSHOT_POLL_INTERVAL_MS, deadline - Date.now());
    await delay(delayMs);
    if (!isActive()) return undefined;

    const latest = getSnapshot();
    if (!latest) return undefined;
    if (sameSnapshot(snapshot, latest)) {
      if (Date.now() - stableSince >= COMPLETION_SNAPSHOT_SETTLE_MS)
        return snapshot;
    } else {
      snapshot = latest;
      stableSince = Date.now();
    }
  }
  return undefined;
}

function raceUntilDeadline<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return Promise.resolve({ timedOut: true });

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), remainingMs);
  });
  return Promise.race([
    promise.then((value) => ({ timedOut: false as const, value })),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameSnapshot<Position extends { lineNumber: number; column: number }>(
  left: CompletionSnapshot<Position>,
  right: CompletionSnapshot<Position>,
) {
  return (
    left.text === right.text &&
    left.version === right.version &&
    left.position.lineNumber === right.position.lineNumber &&
    left.position.column === right.position.column
  );
}
