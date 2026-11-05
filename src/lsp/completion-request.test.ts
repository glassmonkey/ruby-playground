import { describe, expect, it, vi } from "vitest";
import {
  requestForStableSnapshot,
  type CompletionSnapshot,
} from "./completion-request";

type TestSnapshot = CompletionSnapshot<{ lineNumber: number; column: number }>;

describe("requestForStableSnapshot", () => {
  it("retries against the latest document when completion arrives after typing", async () => {
    let current: TestSnapshot = {
      text: 'puts "hello".',
      version: 15,
      position: { lineNumber: 1, column: 14 },
    };
    let resolveFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi.fn(async (snapshot: TestSnapshot) => {
      if (snapshot.version === 15) await firstResponse;
      return snapshot.text;
    });

    const completion = requestForStableSnapshot(
      () => current,
      request,
      () => true,
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    current = {
      text: 'puts "hello".upc',
      version: 18,
      position: { lineNumber: 1, column: 17 },
    };
    resolveFirst();

    await expect(completion).resolves.toEqual({
      snapshot: current,
      value: 'puts "hello".upc',
    });
    expect(request.mock.calls.map(([snapshot]) => snapshot.version)).toEqual([
      15, 18,
    ]);
  });

  it("makes a final bounded request after two stale responses and tracks cursor movement", async () => {
    // Arrange
    let current: TestSnapshot = {
      text: 'puts "hello".',
      version: 15,
      position: { lineNumber: 1, column: 14 },
    };
    const resolveRequests: Array<(value: string) => void> = [];
    const request = vi.fn(
      (snapshot: TestSnapshot) =>
        new Promise<string>((resolve) => {
          resolveRequests.push((value) =>
            resolve(`${snapshot.version}:${value}`),
          );
        }),
    );
    const completion = requestForStableSnapshot(
      () => current,
      request,
      () => true,
    );

    // Act
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    current = {
      text: 'puts "hello".up',
      version: 17,
      position: { lineNumber: 1, column: 16 },
    };
    resolveRequests[0]("stale v15");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    current = {
      text: 'puts "hello".upc',
      version: 18,
      position: { lineNumber: 1, column: 17 },
    };
    resolveRequests[1]("stale v17");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    resolveRequests[2]("current v18");

    // Assert
    await expect(completion).resolves.toEqual({
      snapshot: current,
      value: "18:current v18",
    });
    expect(
      request.mock.calls.map(([snapshot]) => ({
        version: snapshot.version,
        position: snapshot.position,
      })),
    ).toEqual([
      { version: 15, position: { lineNumber: 1, column: 14 } },
      { version: 17, position: { lineNumber: 1, column: 16 } },
      { version: 18, position: { lineNumber: 1, column: 17 } },
    ]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not retry after cancellation", async () => {
    const snapshot: TestSnapshot = {
      text: 'puts "hello".',
      version: 15,
      position: { lineNumber: 1, column: 14 },
    };
    let active = true;
    const request = vi.fn(async () => {
      active = false;
      return [];
    });

    await expect(
      requestForStableSnapshot(
        () => snapshot,
        request,
        () => active,
      ),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
