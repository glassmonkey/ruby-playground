import { describe, expect, it } from "vitest";
import { shouldApplyCompletionResolve } from "./resolve-guard";

const current = {
  cancelled: false,
  modelDisposed: false,
  editorStillOwnsModel: true,
  requestVersion: 7,
  currentVersion: 7,
  clientStillCurrent: true,
};

describe("shouldApplyCompletionResolve", () => {
  it.each([
    ["current request", current, true],
    ["cancelled request", { ...current, cancelled: true }, false],
    ["disposed model", { ...current, modelDisposed: true }, false],
    [
      "replaced editor model",
      { ...current, editorStillOwnsModel: false },
      false,
    ],
    ["changed document", { ...current, currentVersion: 8 }, false],
    [
      "replaced client after version or OFF change",
      { ...current, clientStillCurrent: false },
      false,
    ],
  ])("returns %s", (_name, state, want) => {
    expect(shouldApplyCompletionResolve(state)).toBe(want);
  });
});
