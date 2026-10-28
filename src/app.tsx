import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Icon,
  VisuallyHidden,
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
import { buildShareUrl, parseShareUrl, type ShareState } from "./share";

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
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  const updateUrl = (state: ShareState) => {
    try {
      const url = buildShareUrl(window.location.href, state);
      window.history.replaceState(window.history.state, "", url);
      setWarning("");
    } catch (error) {
      // A stale URL must not silently share the previous editor contents.
      const url = new URL(window.location.href);
      for (const key of ["c", "v", "f"]) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url);
      setWarning(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Box
      minH="100vh"
      p={{ base: 4, lg: 6 }}
      borderTopWidth="4px"
      borderTopColor="ruby.600"
    >
      <Box as="header" mb={6}>
        <Flex align="center" gap={3} mb={3}>
          <Icon
            viewBox="0 0 40 40"
            boxSize={{ base: 9, md: 12 }}
            aria-hidden="true"
          >
            <path fill="#e62923" d="M10 5h20l8 12-18 20L2 17Z" />
            <path fill="#f5a9a7" d="m10 5 10 12H2Z" />
            <path fill="#eb544f" d="M10 5h20L20 17Z" />
            <path fill="#b8211c" d="m30 5 8 12H20L20 37Z" />
            <path fill="#8a1915" d="M38 17 20 37 20 17Z" />
          </Icon>
          <Heading
            as="h1"
            fontWeight="800"
            letterSpacing="-0.05em"
            fontSize={{ base: "2xl", md: "4xl" }}
          >
            <Box as="span" color="accent">
              Ruby
            </Box>{" "}
            Playground
          </Heading>
        </Flex>
        <Text color="mutedText" fontSize="sm">
          コードを書いて、すぐ試す。ブラウザで Ruby を楽しもう。
        </Text>
        <Link
          href="#about"
          display="inline-block"
          mt={2}
          fontSize="sm"
          color="accent"
        >
          About Ruby Playground?
        </Link>
      </Box>
      <Box as="main">
        {warning && (
          <Box role="alert" bg="orange.50" color="orange.900" p={3} mb={4}>
            {warning}
          </Box>
        )}
        <Flex
          gap={4}
          mb={4}
          p={4}
          bg="panelBg"
          borderWidth="1px"
          borderColor="panelBorder"
          rounded="xl"
          wrap="wrap"
          align="center"
          justify="space-between"
        >
          <Link
            href="https://github.com/glassmonkey/ruby-playground/issues"
            isExternal
            fontSize="sm"
            display="inline-flex"
            alignItems="center"
            gap={2}
          >
            <Icon
              viewBox="0 0 16 16"
              boxSize={8}
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </Icon>
            Request and Report
          </Link>
          <Flex gap={4} wrap="wrap" align="center">
            <Button
              as="a"
              href="https://github.com/sponsors/glassmonkey"
              colorScheme="ruby"
              variant="outline"
            >
              Donate
            </Button>
            <Flex align="center" gap={2} maxW="100%" minW={0}>
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
                  const next = event.target.value as RubyVersion;
                  setVersion(next);
                  updateUrl({ code, version: next, format });
                }}
              >
                {RUBY_VERSIONS.map((value) => (
                  <option key={value} value={value}>
                    Ruby {value} ({RUBY_PATCH_VERSIONS[value]})
                  </option>
                ))}
              </Select>
            </Flex>
            <Flex gap={2} align="center">
              <Text as="label" htmlFor="ui-theme" fontSize="xs">
                UI Theme:
              </Text>
              <Switch
                id="ui-theme"
                aria-label="UI Theme"
                size="lg"
                colorScheme="ruby"
                isChecked={colorMode === "light"}
                onChange={toggleColorMode}
              />
            </Flex>
            <Checkbox
              data-testid="checkbox-format"
              isChecked={format === "html"}
              onChange={(event) => {
                const next = event.target.checked ? "html" : "console";
                setFormat(next);
                updateUrl({ code, version, format: next });
              }}
            >
              HTML Preview
            </Checkbox>
          </Flex>
        </Flex>
        <Flex
          direction={{ base: "column", lg: "row" }}
          bg="frameBg"
          borderWidth="1px"
          borderColor="panelBorder"
          rounded="xl"
          p={2}
          gap={2}
          h="80vh"
          minH="480px"
        >
          <Box
            as="section"
            aria-labelledby="editor-heading"
            bg="panelBg"
            borderWidth="1px"
            borderColor="panelBorder"
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
              py={3}
              h={12}
              color="accent"
              bg="panelBg"
              borderColor="panelBorder"
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
                    updateUrl({ code: next, version, format });
                  }}
                />
              </Suspense>
            </Box>
          </Box>
          <Box
            as="section"
            aria-labelledby="output-heading"
            tabIndex={0}
            bg={format === "html" ? "white" : "panelBg"}
            color={format === "html" ? "gray.800" : "inherit"}
            display="flex"
            flexDirection="column"
            flex={1}
            minH={0}
            minW={0}
            overflow="auto"
          >
            <Flex
              align="center"
              justify="space-between"
              px={3}
              h={12}
              minH={12}
              bg="panelBg"
              borderBottomWidth="1px"
              borderColor="panelBorder"
            >
              <Heading id="output-heading" as="h2" size="xs" color="accent">
                出力
              </Heading>
              <Flex gap={3} align="center" color="accent">
                {status === "running" && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      stop();
                      setResult({
                        ...EMPTY_RESULT,
                        error: "実行を停止しました。",
                      });
                      setStatus("done");
                    }}
                  >
                    停止
                  </Button>
                )}
                {status !== "done" && (
                  <Spinner size="sm" aria-label="実行中" color="accent" />
                )}
                <VisuallyHidden role="status">
                  {status === "running"
                    ? "実行中…（初回は Ruby を読み込みます）"
                    : status === "done"
                      ? result.error
                        ? "エラー"
                        : "完了"
                      : "実行待ち"}
                </VisuallyHidden>
              </Flex>
            </Flex>
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
            {status === "done" && !result.output && !result.error && (
              <Text color="gray.500">出力なし</Text>
            )}
          </Box>
        </Flex>
        <Box as="section" id="about" aria-labelledby="about-heading" mt={6}>
          <Heading as="h2" id="about-heading" size="md" mb={3}>
            About Ruby Playground
          </Heading>
          <Text mb={3}>
            コードを編集すると、自動で結果が変わります。Version で Ruby
            を選び、HTML Preview で表示形式を切り替えられます。
          </Text>
          <Text fontSize="sm" color="mutedText" mb={3}>
            編集内容は URL
            に自動保存されます。アドレスバーからコピーして共有できます。コードは
            URL に含まれるため、秘密情報は入力しないでください。
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
          color="mutedText"
        >
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
