import type { LessonPlayground } from "../use-lesson-playground";

export function SampleChoice({
  playground,
  id,
}: {
  playground: LessonPlayground;
  id: string;
}) {
  const sample = playground.samples.find((item) => item.id === id)!;
  return (
    <button
      type="button"
      className="sample-choice"
      aria-pressed={playground.selectedSample === id}
      disabled={!playground.ready}
      onClick={() => playground.selectSample(id)}
    >
      {id === "example" ? "Example" : `Try ${sample.label}`}
    </button>
  );
}

export default function Playground({
  playground: p,
}: {
  playground: LessonPlayground;
}) {
  return (
    <div className="embedded-playground">
      <div className="editor-heading">
        <label htmlFor="lesson-code">Ruby code</label>
        <span className="note">
          Ruby {p.release.patch}
          {p.release.channel === "development" ? " · development" : ""} ·{" "}
          {p.samples.find((sample) => sample.id === p.selectedSample)?.label}
        </span>
      </div>
      <textarea
        id="lesson-code"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={50000}
        value={p.code}
        readOnly={!p.ready}
        rows={Math.min(18, Math.max(8, p.code.split("\n").length + 1))}
        onChange={(event) => p.editCode(event.target.value)}
      />
      <div className="runner-controls">
        <button
          type="button"
          className="button"
          onClick={p.run}
          disabled={!p.ready || p.running}
        >
          Run code
        </button>
        {p.running && (
          <button type="button" onClick={p.stop}>
            Stop
          </button>
        )}
        <a
          href={p.fullPlaygroundUrl}
          aria-disabled={!p.fullPlaygroundUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Continue in full Playground ↗
        </a>
      </div>
      <noscript>
        <p className="note">
          Enable JavaScript to edit and run code here, or use the full
          playground.
        </p>
      </noscript>
      <p
        role="status"
        className={
          p.status === "Ready to run" || p.status === "Complete"
            ? "visually-hidden"
            : "runner-status note"
        }
      >
        {p.status}
      </p>
      <div
        className="lesson-output"
        aria-label="Lesson output"
        role="region"
        aria-busy={p.running}
      >
        <h3>Output</h3>
        {p.result?.error && (
          <p role="alert" className="runner-error">
            {p.result.error}
          </p>
        )}
        <pre data-testid="lesson-output">
          {p.result
            ? p.result.output ||
              (p.result.error
                ? ""
                : "No output — use puts or p to display a value.")
            : "Run the code to see what happens."}
        </pre>
      </div>
      {p.shareWarning && <p role="alert">{p.shareWarning}</p>}
    </div>
  );
}
