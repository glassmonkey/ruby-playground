import type { CancellationToken, editor, languages } from "monaco-editor";
import type { CompletionClient, LspCompletionItem } from "./client";

export type CompletionItemSource = {
  client: CompletionClient;
  model: editor.ITextModel;
  uri: string;
  version: number;
};

export type RubyMonacoCompletion = languages.CompletionItem & {
  rubyLspItem: LspCompletionItem;
  rubyLspSource: CompletionItemSource;
};

export type CompletionResolverContext = {
  currentClient: () => CompletionClient | undefined;
  currentModel: () => editor.ITextModel | undefined;
};

/** Builds the callback registered as Monaco's public resolveCompletionItem provider. */
export function createRubyCompletionResolver(
  context: CompletionResolverContext,
) {
  return async (
    suggestion: languages.CompletionItem,
    token: CancellationToken,
  ): Promise<languages.CompletionItem> => {
    const item = suggestion as RubyMonacoCompletion;
    const source = item.rubyLspSource;
    const client = context.currentClient();
    const model = context.currentModel();
    if (
      !item.rubyLspItem ||
      !source ||
      token.isCancellationRequested ||
      !isCurrentSource(source, client, model)
    )
      return suggestion;

    try {
      const resolved = await source.client.resolve(
        source.uri,
        source.model.getValue(),
        source.version,
        item.rubyLspItem,
      );
      if (
        token.isCancellationRequested ||
        !isCurrentSource(
          source,
          context.currentClient(),
          context.currentModel(),
        )
      )
        return suggestion;

      const documentation = resolved.documentation;
      return {
        ...suggestion,
        detail:
          typeof resolved.detail === "string"
            ? resolved.detail
            : suggestion.detail,
        documentation:
          typeof documentation === "string"
            ? documentation
            : documentation && typeof documentation === "object"
              ? {
                  value: String(
                    (documentation as { value?: unknown }).value ?? "",
                  ),
                  supportHtml: false,
                  supportThemeIcons: false,
                }
              : suggestion.documentation,
      };
    } catch {
      return suggestion;
    }
  };
}

function isCurrentSource(
  source: CompletionItemSource,
  client: CompletionClient | undefined,
  model: editor.ITextModel | undefined,
): boolean {
  return (
    client === source.client &&
    model === source.model &&
    !source.model.isDisposed() &&
    source.model.uri.toString() === source.uri &&
    source.model.getVersionId() === source.version
  );
}
