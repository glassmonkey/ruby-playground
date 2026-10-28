import React from "react";
import { createRoot } from "react-dom/client";
import { resolveLesson } from "./tutorial-content";
import { isRubyVersion } from "./versions";
import TutorialPlayground from "./tutorial-playground";
import TutorialHeader from "./tutorial-header";

const container = document.getElementById("tutorial-runner");
const version = container?.dataset.version;
const lesson = resolveLesson(container?.dataset.lesson ?? "", version ?? "");
if (container && lesson && isRubyVersion(version)) {
  document
    .querySelectorAll("[data-sample-control]")
    .forEach((element) => element.replaceChildren());
  createRoot(container).render(
    <React.StrictMode>
      <TutorialPlayground
        initialCode={lesson.code}
        experiments={lesson.experiments}
        version={version}
      />
    </React.StrictMode>,
  );
}

const header = document.getElementById("tutorial-header-controls");
if (header?.dataset.version) {
  createRoot(header).render(
    <React.StrictMode>
      <TutorialHeader
        version={header.dataset.version}
        slug={header.dataset.lesson || undefined}
      />
    </React.StrictMode>,
  );
}

const sidebar = document.querySelector<HTMLDetailsElement>(
  ".course-sidebar details",
);
if (sidebar && matchMedia("(max-width: 760px)").matches) sidebar.open = false;
