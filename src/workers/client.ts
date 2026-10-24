import type { RunResult } from "../runtime";

export const RUN_TIMEOUT_MS = 20_000;
export type RunHandle = { promise: Promise<RunResult>; cancel: () => void };
/** A fresh worker per run, with explicit settlement even for empty output. */
export function startRubyRun(
  code: string,
  createWorker = () =>
    new Worker(new URL("./ruby-worker.ts", import.meta.url), {
      type: "module",
    }),
  timeoutMs = RUN_TIMEOUT_MS,
): RunHandle {
  let cancel = () => {};
  const promise = new Promise<RunResult>((resolve) => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.terminate();
      resolve(result);
    };
    const fail = (error: string) =>
      finish({ stdout: "", stderr: "", output: "", error });
    cancel = () => fail("実行を停止しました。");
    if (code.length > 50_000) {
      fail("コードは 50,000 文字以内にしてください。");
      return;
    }
    try {
      worker = createWorker();
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (typeof value !== "object" || value === null) {
          fail("Ruby Worker の応答が不正です。");
          return;
        }
        const data = value as Record<string, unknown>;
        const fields = ["stdout", "stderr", "output"] as const;
        if (
          fields.some(
            (key) =>
              typeof data[key] !== "string" ||
              (data[key] as string).length > 100_000,
          ) ||
          (data.error !== undefined &&
            (typeof data.error !== "string" || data.error.length > 100_000))
        ) {
          fail("Ruby Worker の応答が不正です。");
          return;
        }
        finish({
          stdout: data.stdout as string,
          stderr: data.stderr as string,
          output: data.output as string,
          error: data.error as string | undefined,
        });
      };
      worker.onerror = () =>
        fail("Ruby Worker の実行に失敗しました。再実行してください。");
      worker.onmessageerror = () =>
        fail("Ruby Worker の応答を読み取れませんでした。");
      timer = setTimeout(
        () => fail("実行がタイムアウトしました（20 秒）。"),
        timeoutMs,
      );
      worker.postMessage({ code });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  });
  return { promise, cancel: () => cancel() };
}
