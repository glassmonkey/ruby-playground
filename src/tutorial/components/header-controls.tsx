import { useEffect, useState } from "react";
import { lessonPath, tutorialVersions } from "../content";

type ColorMode = "light" | "dark";
const storageKey = "chakra-ui-color-mode";
function preferredMode(): ColorMode {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* The system preference remains available if storage is blocked. */
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function TutorialHeader({
  version,
  slug,
}: {
  version: string;
  slug?: string;
}) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ColorMode>("light");
  useEffect(() => {
    setMode(preferredMode());
    setReady(true);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setMode(preferredMode());
    window.addEventListener("storage", sync);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      media.removeEventListener("change", sync);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  return (
    <div className="tutorial-header-controls">
      <div className="header-version">
        <label htmlFor="tutorial-version">Ruby version</label>
        <select
          id="tutorial-version"
          value={version}
          disabled={!ready}
          onChange={(event) => {
            window.location.assign(
              slug
                ? lessonPath(event.target.value, slug)
                : `/tutorial/${event.target.value}/`,
            );
          }}
        >
          {tutorialVersions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="header-theme">
        <span>UI Theme</span>
        <span>Dark</span>
        <input
          id="tutorial-light-theme"
          type="checkbox"
          aria-label="Light theme"
          checked={mode === "light"}
          disabled={!ready}
          onChange={(event) => {
            const next = event.target.checked ? "light" : "dark";
            setMode(next);
            try {
              localStorage.setItem(storageKey, next);
            } catch {
              /* Keep the selected mode for this page. */
            }
          }}
        />
        <label htmlFor="tutorial-light-theme">Light</label>
      </div>
    </div>
  );
}
