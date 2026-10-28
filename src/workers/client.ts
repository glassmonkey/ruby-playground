import {
  DEFAULT_RUBY_VERSION,
  isRubyVersion,
  type RubyVersion,
} from "../versions";
import type { RunResult, RuntimeInfo } from "../runtime";

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
  version: RubyVersion = DEFAULT_RUBY_VERSION,
  onRuntimeInfo?: (info: RuntimeInfo) => void,
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
    if (!isRubyVersion(version)) {
      fail("Unsupported Ruby version.");
      return;
    }
    if (code.length > 50_000) {
      fail("コードは 50,000 文字以内にしてください。");
      return;
    }
    try {
      worker = createWorker();
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        const value = event.data;
        if (typeof value !== "object" || value === null) {
          fail("Ruby Worker の応答が不正です。");
          return;
        }
        const data = value as Record<string, unknown>;
        if (data.type === "runtime-info") {
          const info = data.info;
          if (
            typeof info !== "object" ||
            info === null ||
            ["version", "platform", "releaseDate", "revision", "encoding"].some(
              (key) => {
                const field = (info as Record<string, unknown>)[key];
                return (
                  typeof field !== "string" ||
                  field.length === 0 ||
                  field.length > 512
                );
              },
            )
          ) {
            fail("Ruby Worker の環境情報が不正です。");
            return;
          }
          const fields = info as RuntimeInfo;
          onRuntimeInfo?.({
            version: fields.version,
            platform: fields.platform,
            releaseDate: fields.releaseDate,
            revision: fields.revision,
            encoding: fields.encoding,
          });
          return;
        }
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
      worker.postMessage({ code, version });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  });
  return { promise, cancel: () => cancel() };
}
