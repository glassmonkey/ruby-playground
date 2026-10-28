import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
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
import type { RunResult, RuntimeInfo } from "./runtime";
import { startRubyRun, type RunHandle } from "./workers/client";
import { RUBY_RELEASES, type RubyVersion } from "./versions";
import { buildShareUrl, parseShareUrl, type ShareState } from "./share";

import Output from "./output";
import RuntimeInfoPanel from "./runtime-info";
import RubyMark from "./ruby-mark";

import { INITIAL_CODE } from "./sample";

const RubyEditor = lazy(() => import("./editor"));
export const LIVE_DELAY_MS = 350;
const EMPTY_RESULT: RunResult = { stdout: "", stderr: "", output: "" };

export default function App() {
  const { colorMode, toggleColorMode } = useColorMode();
  const [initial] = useState(() =>
    parseShareUrl(window.location.href, INITIAL_CODE),
  );
  const [code, setCode] = useState(initial.code);
  const [version, setVersion] = useState(initial.version);
  const [revision, setRevision] = useState(0);
  const [warning, setWarning] = useState(initial.warning ?? "");
  const [environment, setEnvironment] = useState<{
    version: RubyVersion;
    info: RuntimeInfo;
  }>();
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
      const handle = startRubyRun(
        code,
        undefined,
        undefined,
        version,
        (info) => {
          if (current === generation.current) setEnvironment({ version, info });
        },
      );
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
          <RubyMark boxSize={{ base: 9, md: 12 }} />
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
          Run Ruby online in your browser. No installation or account required.
        </Text>
        <Button
          as="a"
          href="/tutorial/"
          colorScheme="ruby"
          size="sm"
          mt={3}
          mr={4}
        >
          Start Ruby tutorial
        </Button>
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
                aria-label="Ruby version"
                value={version}
                width="auto"
                maxW="100%"
                onChange={(event) => {
                  if (event.target.value === version) return;
                  stop();
                  const next = event.target.value as RubyVersion;
                  setVersion(next);
                  updateUrl({ code, version: next });
                }}
              >
                {RUBY_RELEASES.map((release) => (
                  <option key={release.id} value={release.id}>
                    {`Ruby ${release.id} (${release.patch}${release.channel === "development" ? "-dev" : ""})`}
                  </option>
                ))}
              </Select>
            </Flex>
            <Flex gap={2} align="center">
              <Text as="label" htmlFor="ui-theme" fontSize="xs">
                UI Theme:
              </Text>
              <Text
                fontSize="xs"
                fontWeight={colorMode === "dark" ? "bold" : "normal"}
              >
                Dark
              </Text>
              <Switch
                id="ui-theme"
                aria-label="Light theme"
                size="lg"
                colorScheme="ruby"
                isChecked={colorMode === "light"}
                onChange={toggleColorMode}
              />
              <Text
                fontSize="xs"
                fontWeight={colorMode === "light" ? "bold" : "normal"}
              >
                Light
              </Text>
            </Flex>
          </Flex>
        </Flex>
        <RuntimeInfoPanel
          info={environment?.version === version ? environment.info : undefined}
          isLoading={status !== "done"}
        />
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
              Editor
            </Heading>
            <Box flex={1} minH={0}>
              <Suspense fallback={<Spinner aria-label="Loading editor" />}>
                <RubyEditor
                  code={code}
                  onChange={(next) => {
                    if (next === code) return;
                    stop();
                    setCode(next);
                    updateUrl({ code: next, version });
                  }}
                />
              </Suspense>
            </Box>
          </Box>
          <Box
            as="section"
            aria-labelledby="output-heading"
            tabIndex={0}
            bg="panelBg"
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
                Output
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
                        error: "Execution stopped.",
                      });
                      setStatus("done");
                    }}
                  >
                    Stop
                  </Button>
                )}
                {status !== "done" && (
                  <Spinner size="sm" aria-label="Running" color="accent" />
                )}
                <VisuallyHidden role="status">
                  {status === "running"
                    ? "Running… (Ruby may take a moment to load the first time)"
                    : status === "done"
                      ? result.error
                        ? "Error"
                        : "Complete"
                      : "Waiting to run"}
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
            <Output text={result.output} />
            {status === "done" && !result.output && !result.error && (
              <Text color="gray.500">No output</Text>
            )}
          </Box>
        </Flex>
        <Box as="section" id="about" aria-labelledby="about-heading" mt={6}>
          <Heading as="h2" id="about-heading" size="md" mb={3}>
            About Ruby Playground
          </Heading>
          <Heading as="h3" size="sm" mb={2}>
            Run Ruby online without installation
          </Heading>
          <Text mb={4}>
            Ruby Playground lets you write and run Ruby directly in your browser
            using WebAssembly. Try language features, experiment with small
            programs, and share examples without installing Ruby or creating an
            account.
          </Text>
          <Heading as="h3" size="sm" mb={2}>
            How to use the online Ruby editor
          </Heading>
          <Text mb={3}>
            Enter code in the editor to run it automatically. Standard output
            and errors appear in the Output panel as plain text. Choose a Ruby
            version from Version to compare behavior while keeping your code.
          </Text>
          <Text mb={4}>
            Your code and selected version are saved in the address bar as you
            edit. Copy the URL to share an example or bookmark it for later.
            Anyone with the URL can read and run the code, so do not include
            secrets or personal information.
          </Text>
          <Text mb={4}>
            Start with our{" "}
            <Link href="/tutorial/" color="accent">
              Ruby Tutorial
            </Link>{" "}
            to learn step by step, from your first output to classes and
            advanced syntax. Each lesson includes an explanation, runnable code
            and a practice task.
          </Text>
          <Heading as="h3" size="sm" mb={2}>
            Notes
          </Heading>
          <Text mb={3}>
            The playground is designed for trying small Ruby programs. Behavior
            and available features may differ from a local Ruby installation.
          </Text>
          <Text mb={4}>
            Loading and execution may take longer depending on your connection
            and device. Follow any messages shown in the playground if a program
            cannot run or a link cannot be shared.
          </Text>
        </Box>
        <Box as="section" aria-labelledby="faq-heading" mt={6}>
          <Heading as="h2" id="faq-heading" size="md" mb={3}>
            Ruby Playground FAQ
          </Heading>
          <Heading as="h3" size="sm" mb={2}>
            Is Ruby Playground free?
          </Heading>
          <Text mb={4}>
            Yes. You can write, run and share small Ruby programs without an
            account or a local Ruby installation.
          </Text>
          <Heading as="h3" size="sm" mb={2}>
            Why is there no output?
          </Heading>
          <Text mb={4}>
            Code runs automatically after you edit it. Use puts to print text or
            p to inspect a value. Expression return values are not displayed
            automatically. The first run may take longer while Ruby loads.
          </Text>
          <Heading as="h3" size="sm" mb={2}>
            Can I compare Ruby versions?
          </Heading>
          <Text mb={4}>
            Choose a version above the editor to rerun the same code. The
            selector shows the exact bundled versions. Each run starts with a
            fresh environment.
          </Text>
          <Heading as="h3" size="sm" mb={2}>
            Can I use Rails, extra gems or standard input?
          </Heading>
          <Text mb={4}>
            This playground is for single-file Ruby examples. Rails, installing
            extra gems and interactive standard input are not supported. Use
            values in your code instead of gets.
          </Text>
          <Heading as="h3" size="sm" mb={2}>
            How do I save and share my code?
          </Heading>
          <Text>
            Copy or bookmark the address after editing. The URL contains your
            code and selected version, and runs automatically when opened.
            Anyone with the link can read the source.
          </Text>
        </Box>
        <Box as="section" aria-labelledby="safety-heading" mt={6}>
          <Heading as="h2" id="safety-heading" size="sm" mb={3}>
            Security
          </Heading>
          <Text mb={3}>
            Code executes in your browser. Running unfamiliar code can still
            affect your browser or device, so only use code and shared links
            from sources you trust.
          </Text>
          <Text>
            Shared links run automatically when opened, and anyone with the URL
            can read the code. Keep passwords, personal information, and other
            confidential data out of your examples.
          </Text>
        </Box>
        <Box as="section" aria-labelledby="request-heading" mt={6}>
          <Heading as="h2" id="request-heading" size="sm" mb={2}>
            Request and report
          </Heading>
          <Text>
            Found a bug or have an idea? Open an{" "}
            <Link
              href="https://github.com/glassmonkey/ruby-playground/issues"
              isExternal
              color="accent"
            >
              issue on GitHub
            </Link>{" "}
            with the steps to reproduce it. Check that your example contains no
            private information before sharing it.
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
          <Flex as="nav" aria-label="Legal and contact" gap={4} wrap="wrap">
            <Link href="./privacy.html">Privacy Policy</Link>
            <Link href="https://twitter.com/glassmonekey" isExternal>
              Contact
            </Link>
            <Link
              href="https://github.com/glassmonkey/ruby-playground/blob/main/LICENSE"
              isExternal
            >
              License
            </Link>
            <Link
              href="https://github.com/glassmonkey/ruby-playground/blob/main/assets/licenses/THIRD-PARTY-NOTICES.txt"
              isExternal
            >
              Third-party notices
            </Link>
          </Flex>
          <Text as="small">
            © 2026{" "}
            <Link href="https://twitter.com/glassmonekey" isExternal>
              @glassmonekey
            </Link>
          </Text>
        </Flex>
      </Box>
    </Box>
  );
}
