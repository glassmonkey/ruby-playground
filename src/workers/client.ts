import {
  DEFAULT_RUBY_VERSION,
  isRubyVersion,
  type RubyVersion,
} from "../versions";
import type { RunResult, RuntimeInfo } from "../runtime";
import type { ResolvedGem } from "../gems";

export const RUN_TIMEOUT_MS = 20_000;
/** bundle install may fetch many gems; slower is acceptable there. */
export const INSTALL_TIMEOUT_MS = 60_000;
export type RunHandle = { promise: Promise<RunResult>; cancel: () => void };
export type GemOptions = {
  gemfile: string;
  /** Required for a run that uses gems; ignored by install. */
  lock?: ResolvedGem[];
  mode?: "run" | "install";
  onGems?: (gems: ResolvedGem[]) => void;
  onLog?: (line: string) => void;
};
const createRubyWorker = () =>
  new Worker(new URL("./ruby-worker.ts", import.meta.url), {
    type: "module",
  });

/** Resolve the Gemfile and download every gem once, producing Gemfile.lock. */
export function startGemInstall(
  gemfile: string,
  version: RubyVersion,
  onLog?: (line: string) => void,
  createWorker = createRubyWorker,
): {
  promise: Promise<{ lock?: ResolvedGem[]; error?: string }>;
  cancel: () => void;
} {
  let lock: ResolvedGem[] = [];
  const run = startRubyRun(
    "",
    createWorker,
    INSTALL_TIMEOUT_MS,
    version,
    undefined,
    {
      gemfile,
      mode: "install",
      onGems: (gems) => {
        lock = gems;
      },
      onLog,
    },
  );
  return {
    promise: run.promise.then((result) =>
      result.error ? { error: result.error } : { lock },
    ),
    cancel: run.cancel,
  };
}

/** A fresh worker per run, with explicit settlement even for empty output. */
export function startRubyRun(
  code: string,
  createWorker = createRubyWorker,
  timeoutMs = RUN_TIMEOUT_MS,
  version: RubyVersion = DEFAULT_RUBY_VERSION,
  onRuntimeInfo?: (info: RuntimeInfo) => void,
  gems: GemOptions = { gemfile: "" },
): RunHandle {
  const { gemfile, lock, mode = "run", onGems, onLog } = gems;
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
    cancel = () => fail("Execution stopped.");
    if (!isRubyVersion(version)) {
      fail("Unsupported Ruby version.");
      return;
    }
    if (code.length > 50_000) {
      fail("Code must be 50,000 characters or fewer.");
      return;
    }
    try {
      worker = createWorker();
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        const value = event.data;
        if (typeof value !== "object" || value === null) {
          fail("Invalid response from the Ruby worker.");
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
            fail("Invalid runtime information from the Ruby worker.");
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
        if (data.type === "log") {
          if (typeof data.line !== "string" || data.line.length > 500) {
            fail("Invalid response from the Ruby worker.");
            return;
          }
          onLog?.(data.line);
          return;
        }
        if (data.type === "gems") {
          const gems = data.gems;
          if (
            !Array.isArray(gems) ||
            gems.length > 500 ||
            gems.some(
              (gem) =>
                typeof gem !== "object" ||
                gem === null ||
                typeof gem.name !== "string" ||
                typeof gem.version !== "string" ||
                (gem.source !== "rubygems" && gem.source !== "builtin"),
            )
          ) {
            fail("Invalid gem information from the Ruby worker.");
            return;
          }
          onGems?.(
            (gems as ResolvedGem[]).map(({ name, version, source }) => ({
              name,
              version,
              source,
            })),
          );
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
          fail("Invalid response from the Ruby worker.");
          return;
        }
        finish({
          stdout: data.stdout as string,
          stderr: data.stderr as string,
          output: data.output as string,
          error: data.error as string | undefined,
        });
      };
      worker.onerror = () => fail("The Ruby worker failed. Please try again.");
      worker.onmessageerror = () =>
        fail("Could not read the Ruby worker response.");
      timer = setTimeout(
        () =>
          fail(
            mode === "install"
              ? "bundle install timed out after 60 seconds."
              : "Execution timed out after 20 seconds.",
          ),
        timeoutMs,
      );
      worker.postMessage({ code, version, gemfile, lock, mode });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  });
  return { promise, cancel: () => cancel() };
}
