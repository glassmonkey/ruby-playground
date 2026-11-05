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
  path = "main.rb",
}: {
  code: string;
  onChange: (value: string) => void;
  path?: string;
}) {
  const { colorMode } = useColorMode();
  return (
    <Editor
      language="ruby"
      height="100%"
      theme={colorMode === "light" ? "vs" : "vs-dark"}
      path={path}
      value={code}
      onChange={(value) => onChange(value ?? "")}
      options={{
        ariaLabel: path === "main.rb" ? "Ruby source" : `${path} source`,
        tabFocusMode: true,
        minimap: { enabled: false },
        automaticLayout: true,
        fontSize: 15,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        // Room to scroll the last Gemfile lines above the floating install button.
        padding: { bottom: path === "Gemfile" ? 88 : 0 },
      }}
    />
  );
}
