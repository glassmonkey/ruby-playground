import { describe, expect, it, vi } from "vitest";
import type { CancellationToken, editor, languages } from "monaco-editor";
import type { CompletionClient, LspCompletionItem } from "./client";
import {
  createRubyCompletionResolver,
  type CompletionItemSource,
  type RubyMonacoCompletion,
} from "./monaco-completion-resolver";

function makeModel(uri: string, version = 1) {
  return {
    uri: { toString: () => uri },
    version,
    disposed: false,
    text: "Fiber.new {}.ra",
    isDisposed() {
      return this.disposed;
    },
    getVersionId() {
      return this.version;
    },
    getValue() {
      return this.text;
    },
  };
}

function makeClient(
  resolve: CompletionClient["resolve"] = async () => ({ label: "raise" }),
) {
  return { resolve } as unknown as CompletionClient;
}

function makeItem(
  client: CompletionClient,
  model: ReturnType<typeof makeModel>,
  version = model.version,
) {
  const raw: LspCompletionItem = {
    label: "raise",
    kind: 2,
    data: { owner_name: "Fiber", guessed_type: false },
  };
  const source: CompletionItemSource = {
    client,
    model: model as unknown as editor.ITextModel,
    uri: model.uri.toString(),
    version,
  };
  return {
    label: "raise",
    detail: undefined,
    range: {} as languages.CompletionItemRanges,
    insertText: "raise",
    rubyLspItem: raw,
    rubyLspSource: source,
  } as RubyMonacoCompletion;
}

function token(cancelled = false) {
  return { isCancellationRequested: cancelled } as CancellationToken;
}

describe("Monaco completion resolve provider callback", () => {
  it("resolves a current item with its original LSP data and applies returned documentation", async () => {
    const resolve = vi.fn<CompletionClient["resolve"]>(
      async (_uri, _text, _version, item) => ({
        ...item,
        documentation: { kind: "markdown", value: "raise(msg, cause:)" },
      }),
    );
    const client = makeClient(resolve);
    const model = makeModel("inmemory://model/1", 4);
    const item = makeItem(client, model);
    const resolver = createRubyCompletionResolver({
      currentClient: () => client,
      currentModel: () => model as unknown as editor.ITextModel,
    });

    const got = await resolver(item, token());

    expect(resolve).toHaveBeenCalledWith(
      "inmemory://model/1",
      "Fiber.new {}.ra",
      4,
      item.rubyLspItem,
    );
    expect(got).toMatchObject({
      label: "raise",
      documentation: {
        value: "raise(msg, cause:)",
        supportHtml: false,
        supportThemeIcons: false,
      },
    });
  });

  it.each([
    ["same-client document edit", "edit"],
    ["3.3 to 4.0 client switch", "version"],
    ["OFF then ON client replacement", "reenable"],
  ])("does not send an old item after %s", async (_name, change) => {
    const oldResolve = vi.fn<CompletionClient["resolve"]>(async () => ({
      label: "raise",
    }));
    const currentResolve = vi.fn<CompletionClient["resolve"]>(async () => ({
      label: "raise",
    }));
    const oldClient = makeClient(oldResolve);
    const newClient = makeClient(currentResolve);
    const model = makeModel("inmemory://model/1", 4);
    const item = makeItem(oldClient, model);
    let currentClient = oldClient;
    let currentModel = model;

    if (change === "edit") {
      model.version += 1;
      model.text = "Fiber.new {}.raise";
    } else {
      currentClient = newClient;
      if (change === "reenable")
        currentModel = makeModel("inmemory://model/1", 4);
    }

    const resolver = createRubyCompletionResolver({
      currentClient: () => currentClient,
      currentModel: () => currentModel as unknown as editor.ITextModel,
    });
    const got = await resolver(item, token());

    expect(got).toBe(item);
    expect(oldResolve).not.toHaveBeenCalled();
    expect(currentResolve).not.toHaveBeenCalled();
  });

  it.each(["document edit", "client replacement"])(
    "rejects a started resolve after %s",
    async (change) => {
      let finish!: (item: LspCompletionItem) => void;
      const oldResolve = vi.fn<CompletionClient["resolve"]>(
        () =>
          new Promise<LspCompletionItem>((resolve) => {
            finish = resolve;
          }),
      );
      const oldClient = makeClient(oldResolve);
      const newClient = makeClient();
      const model = makeModel("inmemory://model/1", 4);
      const item = makeItem(oldClient, model);
      let currentClient = oldClient;
      let currentModel = model;
      const resolver = createRubyCompletionResolver({
        currentClient: () => currentClient,
        currentModel: () => currentModel as unknown as editor.ITextModel,
      });
      const pending = resolver(item, token());
      await vi.waitFor(() => expect(oldResolve).toHaveBeenCalledOnce());

      if (change === "document edit") model.version += 1;
      else {
        currentClient = newClient;
        currentModel = makeModel("inmemory://model/1", 4);
      }
      finish({
        label: "raise",
        documentation: { kind: "markdown", value: "stale detail" },
      });

      expect(await pending).toBe(item);
    },
  );

  it("does not apply a result after Monaco cancels the provider token", async () => {
    let finish!: (item: LspCompletionItem) => void;
    const resolve = vi.fn<CompletionClient["resolve"]>(
      () =>
        new Promise<LspCompletionItem>((resolve) => {
          finish = resolve;
        }),
    );
    const client = makeClient(resolve);
    const model = makeModel("inmemory://model/1", 4);
    const item = makeItem(client, model);
    const cancellation = { isCancellationRequested: false };
    const resolver = createRubyCompletionResolver({
      currentClient: () => client,
      currentModel: () => model as unknown as editor.ITextModel,
    });
    const pending = resolver(item, cancellation as CancellationToken);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    cancellation.isCancellationRequested = true;
    finish({
      label: "raise",
      documentation: { kind: "markdown", value: "stale detail" },
    });

    expect(await pending).toBe(item);
  });
});
