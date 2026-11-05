import type { ResolvedGem } from "./gems";

export type InstallState = {
  status: "idle" | "installing" | "done" | "error";
  log: string[];
  error?: string;
};

/**
 * Shown like a Gemfile.lock. Gems taken from ruby+stdlib.wasm instead of being
 * downloaded are an implementation detail of this playground, so they are
 * listed with the rest.
 */
export function formatLockfile(gems: ResolvedGem[]): string {
  return [
    "GEM",
    "  remote: https://rubygems.org/",
    "  specs:",
    ...[...gems]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((gem) => `    ${gem.name} (${gem.version})`),
  ].join("\n");
}
