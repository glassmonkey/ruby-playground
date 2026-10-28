import { lessonsForVersion, lessonPath } from "./tutorial-content";

const storagePrefix = "ruby-tutorial-progress:v1:";

function readCompleted(
  raw: string | null,
  validSlugs: Set<string>,
): Set<string> {
  if (raw === null) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value.filter(
        (slug): slug is string =>
          typeof slug === "string" && validSlugs.has(slug),
      ),
    );
  } catch {
    return new Set();
  }
}

export function initializeTutorialProgress(): () => void {
  const version = document.body.dataset.courseVersion ?? "";
  if (!version) return () => {};

  const lessons = lessonsForVersion(version);
  const validSlugs = new Set(lessons.map((lesson) => lesson.slug));
  const storageKey = `${storagePrefix}${version}`;
  const currentLesson = document.body.dataset.currentLesson ?? "";
  const summary = document.querySelector<HTMLElement>(
    "[data-progress-summary]",
  );
  const progress = document.querySelector<HTMLProgressElement>(
    "[data-progress-bar]",
  );
  const lessonLinks =
    document.querySelectorAll<HTMLAnchorElement>("[data-lesson-link]");
  const completeButton = document.querySelector<HTMLButtonElement>(
    "button[data-complete-lesson]",
  );
  const resumeLink = document.querySelector<HTMLAnchorElement>(
    "a[data-resume-course]",
  );
  const sidebarDetails = document.querySelector<HTMLDetailsElement>(
    ".course-sidebar details",
  );
  if (sidebarDetails && window.matchMedia("(max-width: 760px)").matches) {
    sidebarDetails.open = false;
  }

  let completed = new Set<string>();
  try {
    completed = readCompleted(localStorage.getItem(storageKey), validSlugs);
  } catch {
    // Progress remains available for this page even when storage is blocked.
  }

  function render(): void {
    const count = completed.size;
    const total = lessons.length;
    if (summary) summary.textContent = `${count} of ${total} completed`;
    if (progress) {
      progress.max = total || 1;
      progress.value = count;
    }
    for (const link of lessonLinks) {
      const slug = link.dataset.lessonLink ?? "";
      link.dataset.completed = String(completed.has(slug));
    }

    const currentIsComplete = completed.has(currentLesson);
    if (completeButton && validSlugs.has(currentLesson)) {
      completeButton.hidden = false;
      completeButton.textContent = currentIsComplete
        ? "Mark incomplete"
        : "Mark complete";
      completeButton.setAttribute("aria-pressed", String(currentIsComplete));
    }

    if (resumeLink) {
      const nextLesson = lessons.find((lesson) => !completed.has(lesson.slug));
      const target = nextLesson ?? lessons[0];
      resumeLink.href = target
        ? lessonPath(version, target.slug)
        : `/tutorial/${version}/`;
    }
  }

  function save(): void {
    try {
      const ordered = lessons
        .map((lesson) => lesson.slug)
        .filter((slug) => completed.has(slug));
      localStorage.setItem(storageKey, JSON.stringify(ordered));
    } catch {
      // Keep the changed state in memory for the current page.
    }
  }

  function toggleCurrentLesson(): void {
    if (!validSlugs.has(currentLesson)) return;
    if (completed.has(currentLesson)) completed.delete(currentLesson);
    else completed.add(currentLesson);
    save();
    render();
  }

  function syncFromStorage(event: StorageEvent): void {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== localStorage) return;
    } catch {
      return;
    }
    completed = readCompleted(
      event.key === null ? null : event.newValue,
      validSlugs,
    );
    render();
  }

  completeButton?.addEventListener("click", toggleCurrentLesson);
  window.addEventListener("storage", syncFromStorage);
  render();

  return () => {
    completeButton?.removeEventListener("click", toggleCurrentLesson);
    window.removeEventListener("storage", syncFromStorage);
  };
}
