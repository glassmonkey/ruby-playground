import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Input,
  Link,
  Select,
  Switch,
  useColorMode,
  Spinner,
  Text,
} from "@chakra-ui/react";
import type { RunResult } from "./runtime";
import { startRubyRun, type RunHandle } from "./workers/client";
import {
  RUBY_VERSIONS,
  RUBY_PATCH_VERSIONS,
  type RubyVersion,
} from "./versions";
import { buildShareUrl, parseShareUrl } from "./share";

const RubyEditor = lazy(() => import("./editor"));
export const INITIAL_CODE =
  'puts "Hello, Ruby!"\n3.times { |n| puts "Ruby #{n + 1}" }\n';
export const LIVE_DELAY_MS = 350;
const EMPTY_RESULT: RunResult = { stdout: "", stderr: "", output: "" };
const previewDocument = (html: string) =>
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer">${html}`;

export default function App() {
  const { colorMode, toggleColorMode } = useColorMode();
  const [initial] = useState(() =>
    parseShareUrl(window.location.href, INITIAL_CODE),
  );
  const [code, setCode] = useState(initial.code);
  const [version, setVersion] = useState(initial.version);
  const [revision, setRevision] = useState(0);
  const [format, setFormat] = useState(initial.format);
  const [warning, setWarning] = useState(initial.warning ?? "");
  const [result, setResult] = useState<RunResult>(EMPTY_RESULT);
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [shareUrl, setShareUrl] = useState("");
  const run = useRef<RunHandle>();
  const generation = useRef(0);
  const scheduled = useRef<ReturnType<typeof setTimeout>>();
  const stop = () => {
    generation.current++;
    clearTimeout(scheduled.current);
    run.current?.cancel();
    run.current = undefined;
  };
  useEffect(() => {
    const current = ++generation.current;
    run.current?.cancel();
    setResult(EMPTY_RESULT);
    setStatus("idle");
    scheduled.current = setTimeout(async () => {
      setStatus("running");
      const handle = startRubyRun(code, undefined, undefined, version);
      run.current = handle;
      const next = await handle.promise;
      if (current !== generation.current) return;
      run.current = undefined;
      setResult(next);
      setStatus("done");
    }, LIVE_DELAY_MS);
    return () => {
      generation.current++;
      clearTimeout(scheduled.current);
      run.current?.cancel();
      run.current = undefined;
    };
  }, [code, version, revision]);
  useEffect(() => {
    const navigate = () => {
      generation.current++;
      clearTimeout(scheduled.current);
      run.current?.cancel();
      run.current = undefined;
      const state = parseShareUrl(window.location.href, INITIAL_CODE);
      setCode(state.code);
      setVersion(state.version);
      setRevision((value) => value + 1);
      setFormat(state.format);
      setWarning(state.warning ?? "");
      setResult(EMPTY_RESULT);
      setStatus("idle");
      setShareUrl("");
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  const reset = () => {
    stop();
    setCode(INITIAL_CODE);
    setRevision((value) => value + 1);
    setResult(EMPTY_RESULT);
    setStatus("idle");
    setShareUrl("");
  };
  const share = async () => {
    try {
      const url = buildShareUrl(window.location.href, {
        code,
        version,
        format,
      });
      window.history.pushState(null, "", url);
      setShareUrl(url);
      setWarning("");
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* Selectable link remains available. */
      }
    } catch (error) {
      setWarning(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Box minH="100vh" p={4}>
      <Box as="header" mb={4}>
        <Heading as="h1" mb={2}>
          Ruby Playground
        </Heading>
        <Text>
          Ruby Playground lets you execute Ruby code in real time using
          WebAssembly technology.
        </Text>
        <Link href="#about" display="inline-block" mt={3} fontStyle="italic">
          About Ruby Playground?
        </Link>
      </Box>
      <Box as="main">
        {warning && (
          <Box role="alert" bg="orange.50" color="orange.900" p={3} mb={4}>
            {warning}
          </Box>
        )}
        <Flex gap={4} mb={3} wrap="wrap" align="center" justify="space-between">
          <Link
            href="https://github.com/glassmonkey/ruby-playground/issues"
            isExternal
            fontSize="sm"
          >
            &lt; Request and Report
          </Link>
          <Flex gap={4} wrap="wrap" align="center">
            <Button
              as="a"
              href="https://github.com/sponsors/glassmonkey"
              colorScheme="green"
            >
              Donate
            </Button>
            <Text as="label" htmlFor="ruby-version" fontSize="xs">
              Version:
            </Text>
            <Select
              id="ruby-version"
              aria-label="Ruby バージョン"
              value={version}
              width="auto"
              maxW="100%"
              onChange={(event) => {
                if (event.target.value === version) return;
                stop();
                setVersion(event.target.value as RubyVersion);
                setShareUrl("");
              }}
            >
              {RUBY_VERSIONS.map((value) => (
                <option key={value} value={value}>
                  Ruby {value} ({RUBY_PATCH_VERSIONS[value]})
                </option>
              ))}
            </Select>
            <Flex gap={2} align="center">
              <Text as="label" htmlFor="ui-theme" fontSize="xs">
                UI Theme:
              </Text>
              <Switch
                id="ui-theme"
                aria-label="UI Theme"
                size="lg"
                colorScheme="yellow"
                isChecked={colorMode === "light"}
                onChange={toggleColorMode}
              />
            </Flex>
            <Checkbox
              data-testid="checkbox-format"
              isChecked={format === "html"}
              onChange={(event) => {
                setFormat(event.target.checked ? "html" : "console");
                setShareUrl("");
              }}
            >
              HTML Preview
            </Checkbox>
          </Flex>
        </Flex>
        <Flex gap={3} mb={3} wrap="wrap" align="center">
          {status === "running" && (
            <Button
              onClick={() => {
                stop();
                setResult({ ...EMPTY_RESULT, error: "実行を停止しました。" });
                setStatus("done");
              }}
            >
              停止
            </Button>
          )}
          <Button onClick={reset}>サンプルに戻す</Button>
          <Button onClick={() => void share()}>URL を共有</Button>
          <Text role="status" fontSize="sm">
            {status === "running"
              ? "実行中…（初回は Ruby を読み込みます）"
              : status === "done"
                ? result.error
                  ? "エラー"
                  : "完了"
                : "実行待ち"}
          </Text>
        </Flex>
        {shareUrl && (
          <Box mb={4}>
            <Text fontSize="sm">
              共有 URL（コードを含みます。コピーして共有できます）
            </Text>
            <Input
              aria-label="共有 URL"
              value={shareUrl}
              isReadOnly
              onFocus={(e) => e.target.select()}
              bg="white"
              color="gray.800"
            />
          </Box>
        )}
        <Flex
          direction={{ base: "column", lg: "row" }}
          bg="gray.800"
          p={3}
          gap={2}
          h="80vh"
          minH="480px"
        >
          <Box
            as="section"
            aria-labelledby="editor-heading"
            bg={colorMode === "light" ? "white" : "gray.800"}
            borderWidth="1px"
            borderColor="gray.600"
            rounded="md"
            display="flex"
            flexDirection="column"
            flex={1}
            minH={0}
            minW={0}
            overflow="hidden"
          >
            <Heading
              id="editor-heading"
              as="h2"
              size="xs"
              px={3}
              py={2}
              borderBottomWidth="1px"
            >
              エディター
            </Heading>
            <Box flex={1} minH={0}>
              <Suspense
                fallback={<Spinner aria-label="エディター読み込み中" />}
              >
                <RubyEditor
                  code={code}
                  onChange={(next) => {
                    if (next === code) return;
                    stop();
                    setCode(next);
                    setShareUrl("");
                  }}
                />
              </Suspense>
            </Box>
          </Box>
          <Box
            as="section"
            aria-labelledby="output-heading"
            bg="white"
            color="gray.800"
            display="flex"
            flexDirection="column"
            flex={1}
            minH={0}
            minW={0}
            overflow="auto"
          >
            <Heading
              id="output-heading"
              as="h2"
              size="xs"
              px={3}
              py={2}
              borderBottomWidth="1px"
            >
              出力
            </Heading>
            {result.error && (
              <Box
                role="alert"
                bg="red.50"
                color="red.800"
                p={3}
                mb={3}
                whiteSpace="pre-wrap"
                overflowWrap="anywhere"
              >
                {result.error}
              </Box>
            )}
            {format === "console" ? (
              <Box
                as="pre"
                data-testid="preview-console"
                whiteSpace="pre-wrap"
                overflowWrap="anywhere"
                flex={1}
                p={3}
                overflow="auto"
              >
                {result.output}
              </Box>
            ) : (
              <>
                {result.stderr && (
                  <Box
                    as="pre"
                    data-testid="preview-stderr"
                    whiteSpace="pre-wrap"
                    color="red.800"
                  >
                    {result.stderr}
                  </Box>
                )}
                <iframe
                  title="HTML preview"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={previewDocument(result.stdout)}
                  data-testid="preview-html"
                  style={{ width: "100%", flex: 1, minHeight: 0, border: 0 }}
                />
              </>
            )}
            {status === "idle" && (
              <Text color="gray.500">
                編集後、自動でここに結果が表示されます。
              </Text>
            )}
            {status === "done" && !result.output && !result.error && (
              <Text color="gray.500">出力なし</Text>
            )}
          </Box>
        </Flex>
        <Box as="section" id="about" aria-labelledby="about-heading" mt={6}>
          <Heading as="h2" id="about-heading" size="md" mb={3}>
            About Ruby Playground
          </Heading>
          <Badge colorScheme="red" mb={3}>
            Ruby {RUBY_PATCH_VERSIONS[version]} / WASM
          </Badge>
          <Text mb={3}>
            コードを編集すると、自動で結果が変わります。Version で Ruby
            を選び、HTML Preview で表示形式を切り替えられます。
          </Text>
          <Text fontSize="sm" mb={3}>
            編集・バージョン変更後に自動実行します。共有リンクも自動実行されます。信頼できないリンクを開かず、秘密情報は入力しないでください。
            配布 WASM は最新のセキュリティ修正版ではありません。
            低速回線では初回の Ruby
            読み込みがタイムアウトすることがあります。通信環境を変え、コードを編集するかバージョンを変更してください。
          </Text>
        </Box>
        <Flex
          as="footer"
          mt={5}
          pt={4}
          borderTopWidth="1px"
          align="center"
          justify="space-between"
          gap={4}
          wrap="wrap"
          fontSize="sm"
          color={colorMode === "light" ? "gray.600" : "gray.300"}
        >
          <Text>
            毎回、新しい実行環境を使います。上限：20 秒・出力 100 KB・コード
            50,000 文字。標準入力は利用できません。
          </Text>
          <Flex as="nav" aria-label="安全と情報" gap={4} wrap="wrap">
            <Link href="./safety.html">安全な利用</Link>
            <Link href="./privacy.html">プライバシー</Link>
            <Link href="./licenses/">ライセンス</Link>
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
}
