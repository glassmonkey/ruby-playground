import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Input,
  Link,
  Select,
  SimpleGrid,
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
  const [initial] = useState(() =>
    parseShareUrl(window.location.href, INITIAL_CODE),
  );
  const [trusted, setTrusted] = useState(
    () => !new URL(window.location.href).searchParams.has("c"),
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
    if (!trusted) return;
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
  }, [code, version, revision, trusted]);
  useEffect(() => {
    const navigate = () => {
      generation.current++;
      clearTimeout(scheduled.current);
      run.current?.cancel();
      run.current = undefined;
      const state = parseShareUrl(window.location.href, INITIAL_CODE);
      setTrusted(!new URL(window.location.href).searchParams.has("c"));
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
    setTrusted(true);
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
    <Box minH="100vh" bg="gray.50" color="gray.800">
      <Box as="header" bg="white" borderBottomWidth="1px" py={5}>
        <Container maxW="7xl">
          <Flex align="center" gap={3} wrap="wrap">
            <Heading as="h1" size="lg">
              Ruby Playground
            </Heading>
            <Badge colorScheme="red">
              Ruby {RUBY_PATCH_VERSIONS[version]} / WASM
            </Badge>
          </Flex>
          <Text mt={2} color="gray.600">
            書くと、自動で結果が変わる。ブラウザで Ruby を試そう。
          </Text>
        </Container>
      </Box>
      <Container as="main" maxW="7xl" py={6}>
        <Text mb={4} fontSize="sm" color="gray.600">
          編集・バージョン変更後に自動実行します。共有コードは内容と提供元を確認して有効にしてください。秘密情報は入力しないでください。
          配布 WASM は最新のセキュリティ修正版ではありません。
          低速回線では初回の Ruby
          読み込みがタイムアウトすることがあります。通信環境を変え、コードを編集するかバージョンを変更してください。
        </Text>
        {warning && (
          <Box role="alert" bg="orange.50" p={3} mb={4}>
            {warning}
          </Box>
        )}
        {!trusted && (
          <Box bg="orange.50" p={3} mb={4}>
            <Text mb={2}>
              共有コードはまだ実行していません。配布 WASM は古い Ruby
              を含み、信頼できないコードは実行環境の破損やブラウザのリソース消費を起こす可能性があります。内容と提供元を確認してください。
            </Text>
            <Button onClick={() => setTrusted(true)}>
              共有コードを信頼して有効にする
            </Button>
          </Box>
        )}
        <Flex gap={3} mb={4} wrap="wrap" align="center">
          <Select
            aria-label="Ruby バージョン"
            value={version}
            width="auto"
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
          <Select
            aria-label="出力形式"
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as "console" | "html");
              setShareUrl("");
            }}
            width="auto"
          >
            <option value="console">Console</option>
            <option value="html">HTML</option>
          </Select>
          <Text role="status" fontSize="sm">
            {!trusted
              ? "共有コードの確認待ち"
              : status === "running"
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
            />
          </Box>
        )}
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={5}>
          <Box
            as="section"
            aria-labelledby="editor-heading"
            bg="white"
            borderWidth="1px"
            rounded="lg"
            p={4}
            minW={0}
          >
            <Heading id="editor-heading" as="h2" size="md" mb={4}>
              エディター
            </Heading>
            <Suspense fallback={<Spinner aria-label="エディター読み込み中" />}>
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
          <Box
            as="section"
            aria-labelledby="output-heading"
            bg="white"
            borderWidth="1px"
            rounded="lg"
            p={4}
            minW={0}
          >
            <Heading id="output-heading" as="h2" size="md" mb={4}>
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
                maxH="420px"
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
                  style={{ width: "100%", height: 360, border: 0 }}
                />
              </>
            )}
            {status === "idle" && trusted && (
              <Text color="gray.500">
                編集後、自動でここに結果が表示されます。
              </Text>
            )}
            {status === "done" && !result.output && !result.error && (
              <Text color="gray.500">出力なし</Text>
            )}
          </Box>
        </SimpleGrid>
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
          color="gray.600"
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
      </Container>
    </Box>
  );
}
