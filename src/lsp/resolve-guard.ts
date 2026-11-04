export function shouldApplyCompletionResolve(state: {
  cancelled: boolean;
  modelDisposed: boolean;
  editorStillOwnsModel: boolean;
  requestVersion: number;
  currentVersion: number;
  clientStillCurrent: boolean;
}): boolean {
  return (
    !state.cancelled &&
    !state.modelDisposed &&
    state.editorStillOwnsModel &&
    state.requestVersion === state.currentVersion &&
    state.clientStillCurrent
  );
}
