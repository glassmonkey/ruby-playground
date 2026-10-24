import { afterEach, describe, expect, it, vi } from "vitest";
import { startRubyRun } from "./client";
const empty = { stdout: "", stderr: "", output: "" };
const mockWorker = () =>
  ({
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  }) as unknown as Worker;
afterEach(() => vi.useRealTimers());
describe("run lifecycle", () => {
  it("settles empty success and terminates exactly once", async () => {
    const worker = mockWorker();
    const run = startRubyRun("", () => worker);
    worker.onmessage?.call(worker, { data: empty } as MessageEvent);
    expect(await run.promise).toEqual(empty);
    run.cancel();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("cancels and ignores stale completion", async () => {
    const worker = mockWorker();
    const run = startRubyRun("loop {}", () => worker);
    run.cancel();
    worker.onmessage?.call(worker, {
      data: { ...empty, output: "late" },
    } as MessageEvent);
    expect((await run.promise).error).toContain("停止");
  });
  it("times out without waiting for blocked worker", async () => {
    vi.useFakeTimers();
    const worker = mockWorker();
    const run = startRubyRun("loop {}", () => worker, 20);
    vi.advanceTimersByTime(21);
    expect((await run.promise).error).toContain("タイムアウト");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("settles worker construction errors and rejects oversized input before launch", async () => {
    expect(
      (
        await startRubyRun("", () => {
          throw new Error("unavailable");
        }).promise
      ).error,
    ).toBe("unavailable");
    const create = vi.fn();
    expect(
      (await startRubyRun("x".repeat(50_001), create).promise).error,
    ).toContain("50,000");
    expect(create).not.toHaveBeenCalled();
  });
});

it("rejects malformed messages sent by the Ruby JS bridge", async () => {
  for (const data of [
    null,
    {},
    { stdout: 1, stderr: "", output: "" },
    { ...empty, output: "x".repeat(100_001) },
  ]) {
    const worker = mockWorker();
    const run = startRubyRun("", () => worker);
    worker.onmessage?.call(worker, { data } as MessageEvent);
    expect((await run.promise).error).toContain("不正");
  }
});
