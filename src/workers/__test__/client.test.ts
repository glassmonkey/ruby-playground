import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTALL_TIMEOUT_MS, startGemInstall, startRubyRun } from "../client";
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
    expect((await run.promise).error).toContain("stopped");
  });
  it("times out without waiting for blocked worker", async () => {
    vi.useFakeTimers();
    const worker = mockWorker();
    const run = startRubyRun("loop {}", () => worker, 20);
    vi.advanceTimersByTime(21);
    expect((await run.promise).error).toContain("timed out");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("settles a blocked gem install at its install timeout", async () => {
    vi.useFakeTimers();
    const worker = mockWorker();
    const sut = startGemInstall('gem "faker"', "4.0", undefined, () => worker);

    vi.advanceTimersByTime(INSTALL_TIMEOUT_MS);
    const got = await sut.promise;

    expect({
      result: got,
      message: vi.mocked(worker.postMessage).mock.calls[0][0],
      terminated: vi.mocked(worker.terminate).mock.calls.length,
    }).toEqual({
      result: { error: "bundle install timed out after 60 seconds." },
      message: {
        code: "",
        version: "4.0",
        gemfile: 'gem "faker"',
        lock: undefined,
        mode: "install",
      },
      terminated: 1,
    });
  });
  it("collects resolver results and install logs into the lock outcome", async () => {
    const worker = mockWorker();
    const log: string[] = [];
    const sut = startGemInstall(
      'gem "faker"',
      "4.0",
      (line) => log.push(line),
      () => worker,
    );
    const gems = [
      { name: "faker", version: "3.8.0", source: "rubygems" as const },
    ];

    worker.onmessage?.call(worker, {
      data: { type: "log", line: "Fetching gem metadata: faker" },
    } as MessageEvent);
    worker.onmessage?.call(worker, {
      data: { type: "gems", gems },
    } as MessageEvent);
    worker.onmessage?.call(worker, { data: empty } as MessageEvent);
    const got = await sut.promise;

    expect({
      result: got,
      log,
      request: vi.mocked(worker.postMessage).mock.calls[0][0],
      terminated: vi.mocked(worker.terminate).mock.calls.length,
    }).toEqual({
      result: { lock: gems },
      log: ["Fetching gem metadata: faker"],
      request: {
        code: "",
        version: "4.0",
        gemfile: 'gem "faker"',
        lock: undefined,
        mode: "install",
      },
      terminated: 1,
    });
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
    expect((await run.promise).error).toContain("Invalid");
  }
});

it("reports environment information before the code completes", async () => {
  // Arrange
  const worker = mockWorker();
  const onInfo = vi.fn();
  const info = {
    version: "4.0.0",
    platform: "wasm32-wasi",
    releaseDate: "2025-12-25",
    revision: "553f1675f3",
    encoding: "UTF-8",
  };
  const run = startRubyRun("loop {}", () => worker, 20_000, "4.0", onInfo);
  // Act
  worker.onmessage?.call(worker, {
    data: { type: "runtime-info", info },
  } as MessageEvent);
  // Assert
  expect({
    info: onInfo.mock.calls,
    terminated: vi.mocked(worker.terminate).mock.calls.length,
  }).toEqual({ info: [[info]], terminated: 0 });
  // Clean up the intentionally unfinished run.
  run.cancel();
  await run.promise;
});

it.each([
  null,
  {},
  { version: 4 },
  {
    version: "4.0.0",
    platform: "wasm32-wasi",
    releaseDate: "today",
    revision: "a",
    encoding: "x".repeat(513),
  },
])("rejects invalid environment data %j", async (info) => {
  // Arrange
  const worker = mockWorker();
  const onInfo = vi.fn();
  const run = startRubyRun("", () => worker, 20_000, "4.0", onInfo);
  // Act
  worker.onmessage?.call(worker, {
    data: { type: "runtime-info", info },
  } as MessageEvent);
  const result = await run.promise;
  // Assert
  expect({ error: result.error, info: onInfo.mock.calls }).toEqual({
    error: "Invalid runtime information from the Ruby worker.",
    info: [],
  });
});

it("ignores environment messages arriving after cancellation", async () => {
  // Arrange
  const worker = mockWorker();
  const onInfo = vi.fn();
  const run = startRubyRun("", () => worker, 20_000, "4.0", onInfo);
  // Act
  run.cancel();
  worker.onmessage?.call(worker, {
    data: {
      type: "runtime-info",
      info: {
        version: "4.0.0",
        platform: "wasm32-wasi",
        releaseDate: "2025-12-25",
        revision: "553f1675f3",
        encoding: "UTF-8",
      },
    },
  } as MessageEvent);
  await run.promise;
  // Assert
  expect(onInfo.mock.calls).toEqual([]);
});
