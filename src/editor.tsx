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
import { utf8ByteColumnToUtf16 } from "./lsp/positions";
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
      new Worker(new URL("./lsp/worker.ts", import.meta.url), { type: "module" }),
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
    const provider = monaco.languages.registerCompletionItemProvider("ruby", {
      triggerCharacters: [".", ":", "@", "$"],
      provideCompletionItems: async (model, position, _context, token) => {
        const current = client.current;
        if (!current || model.isDisposed()) return { suggestions: [] };
        try {
          // A dot triggers the provider before the user finishes typing a method.
          // If WASM answers after that edit, query the latest snapshot once instead
          // of returning stale text edits or leaving Monaco without candidates.
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
          if (!result || model.isDisposed()) return { suggestions: [] };
          return {
            suggestions: result.value.map((item) =>
              toMonacoCompletion(item, model, result.snapshot.position),
            ),
          };
        } catch {
          return { suggestions: [] };
        }
      },
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
  position: Position,
): monaco.languages.CompletionItem {
  const label = typeof item.label === "string" ? item.label : item.label.label;
  const edit = item.textEdit;
  let monacoRange: monaco.Range;
  if (edit) {
    const range = "range" in edit ? edit.range : edit.replace;
    monacoRange = new monaco.Range(
      range.start.line + 1,
      utf8ByteColumnToUtf16(
        model.getLineContent(range.start.line + 1),
        range.start.character,
      ) + 1,
      range.end.line + 1,
      utf8ByteColumnToUtf16(
        model.getLineContent(range.end.line + 1),
        range.end.character,
      ) + 1,
    );
  } else {
    const range = model.getWordUntilPosition(position);
    monacoRange = new monaco.Range(
      position.lineNumber,
      range.startColumn,
      position.lineNumber,
      range.endColumn,
    );
  }
  const documentation = item.documentation;
  return {
    label,
    kind: completionKind(item.kind),
    detail: item.detail,
    documentation:
      typeof documentation === "string"
        ? documentation
        : documentation?.value,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: edit?.newText ?? item.insertText ?? label,
    range: monacoRange,
  };
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
