import { useColorMode } from "@chakra-ui/react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import type { editor as MonacoEditor, Position } from "monaco-editor";
import "monaco-editor/languages/definitions/ruby/register.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { useEffect, useRef, useState } from "react";
import { CompletionClient } from "./lsp/client";
import { requestForStableSnapshot } from "./lsp/completion-request";
import {
  createRubyCompletionResolver,
  type CompletionItemSource,
  type RubyMonacoCompletion,
} from "./lsp/monaco-completion-resolver";
import { rebaseCompletionEndColumn } from "./lsp/positions";
import { isLspRubyVersion } from "./lsp/versions";
import { DEFAULT_RUBY_VERSION, type RubyVersion } from "./versions";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export default function RubyEditor({
  code,
  onChange,
  version,
  completionEnabled = true,
  onCompletionStatusChange,
}: {
  code: string;
  onChange: (value: string) => void;
  version?: RubyVersion;
  completionEnabled?: boolean;
  onCompletionStatusChange?: (
    status: "disabled" | "loading" | "ready" | "unsupported" | "error",
  ) => void;
}) {
  const { colorMode } = useColorMode();
  const editor = useRef<MonacoEditor.IStandaloneCodeEditor>();
  const [editorReady, setEditorReady] = useState(false);
  const selectedVersion = version ?? DEFAULT_RUBY_VERSION;
  const client = useRef<CompletionClient>();
  const onStatus = useRef(onCompletionStatusChange);

  useEffect(() => {
    onStatus.current = onCompletionStatusChange;
  }, [onCompletionStatusChange]);

  useEffect(() => {
    if (!completionEnabled) {
      onCompletionStatusChange?.("disabled");
      return;
    }
    if (!isLspRubyVersion(selectedVersion)) {
      onCompletionStatusChange?.("unsupported");
      return;
    }

    let active = true;
    onStatus.current?.("loading");
    const current = new CompletionClient(
      new Worker(new URL("./lsp/worker.ts", import.meta.url), {
        type: "module",
      }),
      (status) => {
        if (active) onStatus.current?.(status);
      },
      undefined,
      selectedVersion,
    );
    client.current = current;
    return () => {
      active = false;
      if (client.current === current) client.current = undefined;
      current.dispose();
    };
  }, [completionEnabled, selectedVersion]);

  useEffect(() => {
    if (!editorReady || !editor.current) return;
    const resolveCompletionItem = createRubyCompletionResolver({
      currentClient: () => client.current,
      currentModel: () => editor.current?.getModel() ?? undefined,
    });
    const provider = monaco.languages.registerCompletionItemProvider("ruby", {
      triggerCharacters: [".", ":", "@", "$"],
      provideCompletionItems: async (model, position, _context, token) => {
        const current = client.current;
        if (!current || model.isDisposed()) return { suggestions: [] };
        try {
          // A dot can trigger the provider before the user finishes typing a method.
          // Coalesce newer snapshots during the quiet window and stop at the overall
          // deadline so stale text edits are never returned and retries stay bounded.
          const result = await requestForStableSnapshot(
            () => {
              const activeEditor = editor.current;
              if (activeEditor?.getModel() !== model) return undefined;
              return {
                text: model.getValue(),
                version: model.getVersionId(),
                position: activeEditor.getPosition() ?? position,
              };
            },
            (snapshot) =>
              current.complete(
                model.uri.toString(),
                snapshot.text,
                snapshot.version,
                {
                  line: snapshot.position.lineNumber - 1,
                  character: snapshot.position.column - 1,
                },
              ),
            () =>
              !token.isCancellationRequested &&
              !model.isDisposed() &&
              client.current === current,
          );
          if (
            !result ||
            model.isDisposed() ||
            result.snapshot.position.lineNumber !== position.lineNumber
          )
            return { suggestions: [] };
          const suggestions = result.value
            .map((item) =>
              toMonacoCompletion(
                item,
                model,
                result.snapshot.position,
                position,
                {
                  client: current,
                  model,
                  uri: model.uri.toString(),
                  version: result.snapshot.version,
                },
              ),
            )
            .filter(
              (item): item is monaco.languages.CompletionItem =>
                item !== undefined,
            );
          return {
            suggestions,
          };
        } catch {
          return { suggestions: [] };
        }
      },
      resolveCompletionItem,
    });
    return () => provider.dispose();
  }, [editorReady]);

  return (
    <Editor
      language="ruby"
      height="100%"
      theme={colorMode === "light" ? "vs" : "vs-dark"}
      value={code}
      onChange={(value) => onChange(value ?? "")}
      onMount={(instance) => {
        editor.current = instance;
        setEditorReady(true);
      }}
      options={{
        ariaLabel: "Ruby source",
        tabFocusMode: true,
        minimap: { enabled: false },
        automaticLayout: true,
        fontSize: 15,
        scrollBeyondLastLine: false,
        wordWrap: "on",
      }}
    />
  );
}

type LspCompletionItem = {
  label: string | { label: string };
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  textEdit?:
    | {
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }
    | {
        insert: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        replace: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      };
};
function toMonacoCompletion(
  item: LspCompletionItem,
  model: MonacoEditor.ITextModel,
  responsePosition: Position,
  requestPosition: Position,
  source: CompletionItemSource,
): monaco.languages.CompletionItem | undefined {
  const label = typeof item.label === "string" ? item.label : item.label.label;
  const edit = item.textEdit;
  const toMonacoRange = (range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }): monaco.Range | undefined => {
    const lineNumber = responsePosition.lineNumber;
    if (
      range.start.line !== lineNumber - 1 ||
      range.end.line !== lineNumber - 1
    )
      return undefined;
    // TypeProf negotiates UTF-16 and the adapter emits textEdit columns in
    // those same LSP units.
    const startColumn = range.start.character + 1;
    const responseEndColumn = range.end.character + 1;
    const endColumn = rebaseCompletionEndColumn(
      responseEndColumn,
      requestPosition.column,
      responsePosition.column,
    );
    if (
      endColumn < startColumn ||
      endColumn > model.getLineMaxColumn(lineNumber)
    )
      return undefined;
    return new monaco.Range(lineNumber, startColumn, lineNumber, endColumn);
  };
  let monacoRange:
    monaco.Range | monaco.languages.CompletionItemRanges | undefined;
  if (edit) {
    if ("range" in edit) {
      monacoRange = toMonacoRange(edit.range);
    } else {
      const insert = toMonacoRange(edit.insert);
      const replace = toMonacoRange(edit.replace);
      if (insert && replace) monacoRange = { insert, replace };
    }
  } else {
    const range = model.getWordUntilPosition(responsePosition);
    const endColumn = rebaseCompletionEndColumn(
      range.endColumn,
      requestPosition.column,
      responsePosition.column,
    );
    if (endColumn < range.startColumn) return undefined;
    monacoRange = new monaco.Range(
      responsePosition.lineNumber,
      range.startColumn,
      responsePosition.lineNumber,
      endColumn,
    );
  }
  if (!monacoRange) return undefined;
  const documentation = item.documentation;
  return {
    label,
    kind: completionKind(item.kind),
    detail: item.detail,
    documentation:
      typeof documentation === "string" ? documentation : documentation?.value,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: edit?.newText ?? item.insertText ?? label,
    range: monacoRange,
    rubyLspItem: item,
    rubyLspSource: source,
  } as RubyMonacoCompletion;
}

function completionKind(kind?: number): monaco.languages.CompletionItemKind {
  const kinds = [
    monaco.languages.CompletionItemKind.Text,
    monaco.languages.CompletionItemKind.Method,
    monaco.languages.CompletionItemKind.Function,
    monaco.languages.CompletionItemKind.Constructor,
    monaco.languages.CompletionItemKind.Field,
    monaco.languages.CompletionItemKind.Variable,
    monaco.languages.CompletionItemKind.Class,
    monaco.languages.CompletionItemKind.Interface,
    monaco.languages.CompletionItemKind.Module,
    monaco.languages.CompletionItemKind.Property,
    monaco.languages.CompletionItemKind.Unit,
    monaco.languages.CompletionItemKind.Value,
    monaco.languages.CompletionItemKind.Enum,
    monaco.languages.CompletionItemKind.Keyword,
    monaco.languages.CompletionItemKind.Snippet,
    monaco.languages.CompletionItemKind.Color,
    monaco.languages.CompletionItemKind.File,
    monaco.languages.CompletionItemKind.Reference,
  ];
  return kinds[(kind ?? 1) - 1] ?? monaco.languages.CompletionItemKind.Text;
}
