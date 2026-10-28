import { useEffect, useRef, useState } from "react";
import type { LessonExperiment } from "./content";
import { startRubyRun, type RunHandle } from "../workers/client";
import type { RunResult } from "../runtime";
import { buildShareUrl } from "../share";
import { RUBY_RELEASES, type RubyVersion } from "../versions";

export function useLessonPlayground(
  initialCode: string,
  experiments: LessonExperiment[],
  version: RubyVersion,
) {
  const release = RUBY_RELEASES.find((item) => item.id === version)!;
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [selectedSample, setSelectedSample] = useState("example");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const samples = [
    { id: "example", label: "Example", code: initialCode },
    ...experiments.map((item) => ({
      id: `experiment:${item.id}`,
      label: item.title,
      code: item.code,
    })),
  ];
  const code =
    drafts[selectedSample] ??
    samples.find((sample) => sample.id === selectedSample)!.code;
  function setCode(value: string) {
    setDrafts((previous) => ({ ...previous, [selectedSample]: value }));
  }
  const [result, setResult] = useState<RunResult>();
  const [status, setStatus] = useState("Ready to run");
  const [running, setRunning] = useState(false);
  const active = useRef<RunHandle>();
  const generation = useRef(0);

  function cancel() {
    generation.current++;
    active.current?.cancel();
    active.current = undefined;
    setRunning(false);
  }

  useEffect(
    () => () => {
      generation.current++;
      active.current?.cancel();
    },
    [],
  );

  async function run() {
    cancel();
    const current = generation.current;
    setRunning(true);
    setResult(undefined);
    setStatus("Running — Ruby may take a moment to load the first time");
    const handle = startRubyRun(code, undefined, undefined, version);
    active.current = handle;
    const next = await handle.promise;
    if (generation.current !== current) return;
    active.current = undefined;
    setResult(next);
    setRunning(false);
    setStatus(next.error ? "Error" : "Complete");
  }

  let fullPlaygroundUrl: string | undefined;
  let shareWarning = "";
  try {
    const absoluteShareUrl = buildShareUrl(
      new URL("/#editor-heading", "https://ruby-play.dev"),
      { code, version },
    );
    const shareUrl = new URL(absoluteShareUrl);
    fullPlaygroundUrl = `${shareUrl.pathname}${shareUrl.search}${shareUrl.hash}`;
  } catch (error) {
    shareWarning = error instanceof Error ? error.message : String(error);
  }

  function selectSample(id: string) {
    if (id === selectedSample) return;
    cancel();
    setSelectedSample(id);
    setResult(undefined);
    setStatus("Ready to run");
  }
  function editCode(value: string) {
    cancel();
    setCode(value);
    setStatus("Code changed — run to update the output");
  }
  function stop() {
    cancel();
    setStatus("Stopped — edit or run again");
  }
  return {
    ready,
    release,
    selectedSample,
    samples,
    code,
    result,
    status,
    running,
    run,
    stop,
    selectSample,
    editCode,
    fullPlaygroundUrl,
    shareWarning,
  };
}
export type LessonPlayground = ReturnType<typeof useLessonPlayground>;
