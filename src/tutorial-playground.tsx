import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LessonExperiment } from "./tutorial-content";
import { startRubyRun, type RunHandle } from "./workers/client";
import type { RunResult } from "./runtime";
import { buildShareUrl } from "./share";
import { RUBY_PATCH_VERSIONS, type RubyVersion } from "./versions";

export default function TutorialPlayground({
  initialCode,
  experiments,
  version,
}: {
  initialCode: string;
  experiments: LessonExperiment[];
  version: RubyVersion;
}) {
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
  const editor = useRef<HTMLTextAreaElement>(null);
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
    fullPlaygroundUrl = buildShareUrl(
      new URL("/#editor-heading", window.location.href),
      { code, version },
    );
  } catch (error) {
    shareWarning = error instanceof Error ? error.message : String(error);
  }

  return (
    <div className="embedded-playground">
      {samples.map((sample) => {
        const target = document.getElementById(`sample-${sample.id}`);
        return target
          ? createPortal(
              <button
                type="button"
                className="sample-choice"
                aria-pressed={selectedSample === sample.id}
                onClick={() => {
                  if (selectedSample === sample.id) return;
                  cancel();
                  setSelectedSample(sample.id);
                  setResult(undefined);
                  setStatus("Ready to run");
                }}
              >
                {sample.id === "example" ? "Example" : `Try ${sample.label}`}
              </button>,
              target,
              sample.id,
            )
          : null;
      })}
      <div className="editor-heading">
        <label htmlFor="lesson-code">Ruby code</label>
        <span className="note">
          Ruby {RUBY_PATCH_VERSIONS[version]}
          {version === "4.1" ? " · development" : ""} ·{" "}
          {samples.find((sample) => sample.id === selectedSample)?.label}
        </span>
      </div>
      <textarea
        id="lesson-code"
        ref={editor}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={50000}
        value={code}
        rows={Math.min(18, Math.max(8, code.split("\n").length + 1))}
        onChange={(event) => {
          cancel();
          setCode(event.target.value);
          setStatus("Code changed — run to update the output");
        }}
      />
      <div className="runner-controls">
        <button
          type="button"
          className="button"
          onClick={run}
          disabled={running}
        >
          Run code
        </button>
        {running && (
          <button
            type="button"
            onClick={() => {
              cancel();
              setStatus("Stopped — edit or run again");
            }}
          >
            Stop
          </button>
        )}
        <a
          href={fullPlaygroundUrl}
          aria-disabled={!fullPlaygroundUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Continue in full Playground ↗
        </a>
      </div>
      <p
        role="status"
        className={
          status === "Ready to run" || status === "Complete"
            ? "visually-hidden"
            : "runner-status note"
        }
      >
        {status}
      </p>
      <div
        className="lesson-output"
        aria-label="Lesson output"
        role="region"
        aria-busy={running}
      >
        <h3>Output</h3>
        {result?.error && (
          <p role="alert" className="runner-error">
            {result.error}
          </p>
        )}
        <pre data-testid="lesson-output">
          {result
            ? result.output ||
              (result.error
                ? ""
                : "No output — use puts or p to display a value.")
            : "Run the code to see what happens."}
        </pre>
      </div>
      {shareWarning && <p role="alert">{shareWarning}</p>}
    </div>
  );
}
