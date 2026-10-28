import { useColorMode } from "@chakra-ui/react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/ruby/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export default function RubyEditor({
  code,
  onChange,
}: {
  code: string;
  onChange: (value: string) => void;
}) {
  const { colorMode } = useColorMode();
  return (
    <Editor
      language="ruby"
      height="100%"
      theme={colorMode === "light" ? "vs" : "vs-dark"}
      value={code}
      onChange={(value) => onChange(value ?? "")}
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
