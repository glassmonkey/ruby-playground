const shareParameters = ["c", "v", "f"] as const;
const robotsMarker = "data-share-noindex";

export function hasShareParameters(search: string): boolean {
  const params = new URLSearchParams(search);
  return shareParameters.some((name) => params.has(name));
}

export function syncRobotsMeta(
  search: string,
  head: Pick<HTMLElement, "querySelector" | "append"> = document.head,
): void {
  const existing = head.querySelector<HTMLMetaElement>(`meta[${robotsMarker}]`);
  if (hasShareParameters(search)) {
    if (!existing) {
      const meta = document.createElement("meta");
      meta.name = "robots";
      meta.content = "noindex";
      meta.setAttribute(robotsMarker, "");
      head.append(meta);
    }
    return;
  }
  existing?.remove();
}

export function installIndexingPolicy(): void {
  const sync = () => syncRobotsMeta(window.location.search);
  sync();
  window.addEventListener("popstate", sync);

  // The share action uses pushState; browsers do not emit popstate for it.
  const originalPushState = window.history.pushState;
  window.history.pushState = function (...args) {
    originalPushState.apply(this, args);
    sync();
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installIndexingPolicy();
}
