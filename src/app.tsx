import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Code,
  Flex,
  Heading,
  Icon,
  VisuallyHidden,
  Link,
  Select,
  Switch,
  useColorMode,
  Spinner,
  Tab,
  TabList,
  Tabs,
  Text,
} from "@chakra-ui/react";
import type { RunResult, RuntimeInfo } from "./runtime";
import {
  startGemInstall,
  startRubyRun,
  type RunHandle,
} from "./workers/client";
import { RUBY_RELEASES, type RubyVersion } from "./versions";
import { buildShareUrl, parseShareUrl, type ShareState } from "./share";
import type { ResolvedGem } from "./gems";

import Output from "./output";
import RuntimeInfoPanel from "./runtime-info";
import Brand from "./brand";
import About from "./about";
import { formatLockfile, type InstallState } from "./lockfile";
import {
  extensionIssueUrl,
  missingExtension,
  missingRequire,
  searchQuery,
  searchUrl,
} from "./missing-require";

import { INITIAL_CODE } from "./sample";

const RubyEditor = lazy(() => import("./editor"));
export const LIVE_DELAY_MS = 350;
const EMPTY_RESULT: RunResult = { stdout: "", stderr: "", output: "" };
const IDLE_INSTALL: InstallState = { status: "idle", log: [] };

/** A lockfile is valid only for the Gemfile text and Ruby version it was made from. */
type GemLock = { gemfile: string; version: RubyVersion; gems: ResolvedGem[] };
// Each file's output sits in the same right-hand frame: main.rb prints, the
// Gemfile produces Gemfile.lock. Errors and guidance stay at the top of it.
const EDITOR_TABS = ["main.rb", "Gemfile"] as const;
type EditorTab = (typeof EDITOR_TABS)[number];

export default function App() {
  const { colorMode, toggleColorMode } = useColorMode();
  const [initial] = useState(() =>
    parseShareUrl(window.location.href, INITIAL_CODE),
  );
  const [code, setCode] = useState(initial.code);
  const [version, setVersion] = useState(initial.version);
  const [gemfile, setGemfile] = useState(initial.gemfile);
  const [tab, setTab] = useState<EditorTab>("main.rb");
  const [lock, setLock] = useState<GemLock | undefined>(() =>
    initial.lock
      ? {
          gemfile: initial.gemfile,
          version: initial.version,
          gems: initial.lock,
        }
      : undefined,
  );
  const [install, setInstall] = useState<InstallState>(IDLE_INSTALL);
  const installRun = useRef<{ cancel: () => void }>();
  const lockFor = (forGemfile: string, forVersion: RubyVersion) =>
    lock && lock.gemfile === forGemfile && lock.version === forVersion
      ? lock.gems
      : undefined;
  const activeLock = lockFor(gemfile, version);
  const hasGems = /^\s*gem\s/m.test(gemfile);
  // Only a Gemfile the user edited needs an explicit bundle install; a missing
  // or outdated lockfile on load or after a Ruby switch is installed silently.
  const [gemfileEdited, setGemfileEdited] = useState(false);
  const waitingForGems = hasGems && !activeLock && !gemfileEdited;
  const autoInstalled = useRef<string>();
  // Install completes asynchronously; it must save the latest editor state.
  const latest = useRef({ code, version, gemfile });
  latest.current = { code, version, gemfile };
  const [revision, setRevision] = useState(0);
  const [warning, setWarning] = useState(initial.warning ?? "");
  const [environment, setEnvironment] = useState<{
    version: RubyVersion;
    info: RuntimeInfo;
  }>();
  const [result, setResult] = useState<RunResult>(EMPTY_RESULT);
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  // result always belongs to the current code: each edit clears it before rerunning.
  const missingFeature = missingRequire(result.error, code);
  const nativeExtension = missingExtension(result.error);
  const lockStatus =
    install.status === "installing"
      ? "Running bundle install…"
      : activeLock
        ? "Gemfile.lock matches the Gemfile. main.rb downloads these versions when it runs."
        : lock
          ? "The Gemfile or Ruby version changed, so Gemfile.lock is out of date. Run bundle install to update it."
          : hasGems
            ? "No Gemfile.lock yet. Press bundle install."
            : "No Gemfile.lock yet. Add gems to the Gemfile and press bundle install to create one.";
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
    // The automatic install sets the lockfile, which re-runs this effect.
    if (waitingForGems) return;
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
        { gemfile, lock: activeLock },
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
    // Gemfile edits are not a dependency, and neither is a lockfile going
    // stale: the last result (such as a LoadError) stays in place until a new
    // lockfile arrives, and the run then reads whatever lock is valid.
  }, [code, version, lock, waitingForGems, revision]);
  const stopInstall = () => {
    installRun.current?.cancel();
    installRun.current = undefined;
    setInstall(IDLE_INSTALL);
  };
  const runInstall = async () => {
    installRun.current?.cancel();
    const target = { gemfile, version };
    const handle = startGemInstall(gemfile, version, (line) => {
      if (installRun.current === handle)
        setInstall((state) => ({ ...state, log: [...state.log, line] }));
    });
    installRun.current = handle;
    setInstall({ status: "installing", log: [] });
    const outcome = await handle.promise;
    if (installRun.current !== handle) return;
    installRun.current = undefined;
    if (outcome.error !== undefined) {
      setInstall((state) => ({
        ...state,
        status: "error",
        error: outcome.error,
      }));
      return;
    }
    const gems = outcome.lock ?? [];
    setLock({ ...target, gems });
    setGemfileEdited(false);
    setInstall((state) => ({ ...state, status: "done" }));
    updateUrl({ ...latest.current, lock: gems });
  };
  useEffect(() => {
    if (!waitingForGems) return;
    // One attempt per Gemfile and Ruby version, so a failure is not retried in a loop.
    const key = `${version}\n${gemfile}`;
    if (autoInstalled.current === key) return;
    autoInstalled.current = key;
    void runInstall();
  }, [waitingForGems, gemfile, version]);
  useEffect(() => {
    const navigate = () => {
      generation.current++;
      clearTimeout(scheduled.current);
      run.current?.cancel();
      run.current = undefined;
      const state = parseShareUrl(window.location.href, INITIAL_CODE);
      setCode(state.code);
      setVersion(state.version);
      setGemfile(state.gemfile);
      setLock(
        state.lock
          ? { gemfile: state.gemfile, version: state.version, gems: state.lock }
          : undefined,
      );
      installRun.current?.cancel();
      installRun.current = undefined;
      setInstall(IDLE_INSTALL);
      setGemfileEdited(false);
      autoInstalled.current = undefined;
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
      for (const key of ["c", "v", "g", "l", "f"]) url.searchParams.delete(key);
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
          <Brand heading />
        </Flex>
        <Text color="mutedText" fontSize="sm">
          Run Ruby online in your browser. No installation or account required.
        </Text>
        <Flex as="nav" aria-label="Introduction" gap={4} mt={2} wrap="wrap">
          <Link href="#about" fontSize="sm" color="accent">
            About Ruby Playground?
          </Link>
          <Link href="/tutorial/" fontSize="sm" color="accent">
            Want to learn Ruby?
          </Link>
        </Flex>
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
                  stopInstall();
                  updateUrl({
                    code,
                    version: next,
                    gemfile,
                    lock: lockFor(gemfile, next),
                  });
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
            <Flex
              align="center"
              justify="space-between"
              px={3}
              h={12}
              minH={12}
              bg="panelBg"
              borderColor="panelBorder"
              borderBottomWidth="1px"
            >
              <Heading id="editor-heading" as="h2" size="xs" color="accent">
                Editor
              </Heading>
              <Tabs
                size="sm"
                variant="soft-rounded"
                colorScheme="ruby"
                index={EDITOR_TABS.indexOf(tab)}
                onChange={(index) => setTab(EDITOR_TABS[index])}
              >
                <TabList>
                  {EDITOR_TABS.map((name) => (
                    <Tab key={name}>{name}</Tab>
                  ))}
                </TabList>
              </Tabs>
            </Flex>
            {tab === "Gemfile" && (
              <Box
                px={3}
                py={2}
                fontSize="xs"
                color="mutedText"
                borderBottomWidth="1px"
                borderColor="panelBorder"
              >
                <Text>
                  Write one gem per line, then press bundle install at the
                  bottom right. Dependencies are resolved too, and a
                  Gemfile.lock is created.
                </Text>
                <Text mt={1}>
                  Example: <Code fontSize="xs">{'gem "faker"'}</Code>
                  {"  With a version: "}
                  <Code fontSize="xs">{'gem "faker", "~> 3.8"'}</Code>
                </Text>
              </Box>
            )}
            <Box flex={1} minH={0} position="relative">
              {tab === "Gemfile" && (
                <Button
                  position="absolute"
                  right={6}
                  bottom={5}
                  zIndex={2}
                  size="lg"
                  rounded="full"
                  boxShadow="lg"
                  colorScheme="ruby"
                  variant={
                    install.status === "installing" ? "outline" : "solid"
                  }
                  bg={install.status === "installing" ? "panelBg" : undefined}
                  leftIcon={
                    install.status === "installing" ? (
                      <Spinner size="sm" />
                    ) : (
                      <Icon viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M8 1.5v8.5M4.5 6.5 8 10l3.5-3.5M2.5 14h11"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Icon>
                    )
                  }
                  onClick={
                    install.status === "installing" ? stopInstall : runInstall
                  }
                >
                  {install.status === "installing" ? "Stop" : "bundle install"}
                </Button>
              )}
              <Suspense fallback={<Spinner aria-label="Loading editor" />}>
                <RubyEditor
                  path={tab}
                  code={tab === "main.rb" ? code : gemfile}
                  onChange={(next) => {
                    if (tab === "Gemfile") {
                      if (next === gemfile) return;
                      stopInstall();
                      setGemfile(next);
                      setGemfileEdited(true);
                      // Only a lockfile made from this exact Gemfile is shared.
                      updateUrl({
                        code,
                        version,
                        gemfile: next,
                        lock: lockFor(next, version),
                      });
                      return;
                    }
                    if (next === code) return;
                    stop();
                    setCode(next);
                    updateUrl({
                      code: next,
                      version,
                      gemfile,
                      lock: activeLock,
                    });
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
            {missingFeature && (
              <Box
                mx={3}
                mb={3}
                p={3}
                fontSize="sm"
                borderWidth="1px"
                borderColor="panelBorder"
                rounded="md"
              >
                <Text mb={2}>
                  {`Could not load "${missingFeature}". Add it to the Gemfile and run bundle install.`}
                </Text>
                <Flex gap={4} align="center" wrap="wrap">
                  <Button
                    size="sm"
                    colorScheme="ruby"
                    onClick={() => setTab("Gemfile")}
                  >
                    Open Gemfile
                  </Button>
                  <Link
                    href={searchUrl(missingFeature)}
                    isExternal
                    color="accent"
                  >
                    {`Search rubygems.org for "${searchQuery(missingFeature)}"`}
                  </Link>
                </Flex>
              </Box>
            )}
            {nativeExtension && (
              <Box
                mx={3}
                mb={3}
                p={3}
                fontSize="sm"
                borderWidth="1px"
                borderColor="panelBorder"
                rounded="md"
              >
                <Text mb={2}>
                  {nativeExtension.gem
                    ? `The ${nativeExtension.gem.name} gem (${nativeExtension.gem.version}) needs the native extension "${nativeExtension.extension}", which this playground cannot load yet.`
                    : `The native extension "${nativeExtension.extension}" cannot be loaded in this playground yet.`}{" "}
                  If you need it, please let us know in an issue.
                </Text>
                <Link
                  href={extensionIssueUrl(nativeExtension)}
                  isExternal
                  color="accent"
                >
                  Open an issue
                </Link>
              </Box>
            )}
            {/* Below the run's error, so that error keeps its place during an install.
                The Gemfile output below shows the full log instead. */}
            {tab === "main.rb" && install.status === "installing" && (
              <Box
                mx={3}
                mb={3}
                p={3}
                fontSize="sm"
                borderWidth="1px"
                borderColor="panelBorder"
                rounded="md"
                aria-live="polite"
              >
                <Flex align="center" gap={2}>
                  <Spinner size="xs" color="accent" />
                  <Text>Running bundle install…</Text>
                </Flex>
                <Box as="pre" mt={2} fontSize="xs" whiteSpace="pre-wrap">
                  {install.log.join("\n")}
                </Box>
              </Box>
            )}
            {install.status === "error" && (
              <Box
                role="alert"
                bg="red.50"
                color="red.800"
                p={3}
                mx={3}
                mb={3}
                whiteSpace="pre-wrap"
                overflowWrap="anywhere"
              >
                {`bundle install failed: ${install.error}`}
              </Box>
            )}
            {tab === "main.rb" ? (
              <>
                {waitingForGems && install.status === "idle" && (
                  <Text px={3} py={2} fontSize="sm">
                    No Gemfile.lock yet. Run bundle install from the Gemfile
                    tab.
                  </Text>
                )}
                <Output text={result.output} />
                {status === "done" && !result.output && !result.error && (
                  <Text color="gray.500">No output</Text>
                )}
              </>
            ) : (
              <Box px={3} py={2}>
                <Flex align="center" gap={2} fontSize="sm" aria-live="polite">
                  {install.status === "installing" && (
                    <Spinner size="xs" color="accent" />
                  )}
                  <Text>{lockStatus}</Text>
                </Flex>
                {install.log.length > 0 && (
                  <Box as="pre" mt={3} fontSize="sm" whiteSpace="pre-wrap">
                    {install.log.join("\n")}
                  </Box>
                )}
                {lock && (
                  <>
                    <Heading as="h3" size="xs" mt={4} mb={2} color="accent">
                      {activeLock
                        ? "Gemfile.lock"
                        : "Gemfile.lock (out of date)"}
                    </Heading>
                    <Box as="pre" fontSize="sm" whiteSpace="pre">
                      {formatLockfile(lock.gems)}
                    </Box>
                  </>
                )}
              </Box>
            )}
          </Box>
        </Flex>
        <About />
        <Box as="section" aria-labelledby="safety-heading" mt={6}>
          <Heading as="h2" id="safety-heading" size="sm" mb={3}>
            Security
          </Heading>
          <Text mb={3}>
            Code executes in your browser. Running unfamiliar code can still
            affect your browser or device, so only use code and shared links
            from sources you trust.
          </Text>
          <Text mb={3}>
            Shared links run automatically when opened, and anyone with the URL
            can read the code. Keep passwords, personal information, and other
            confidential data out of your examples.
          </Text>
          <Text>
            A shared Gemfile can cause third-party gems to be downloaded and run
            in your browser. The gem proxy receives your IP address and
            requested gem names, and downloaded gem files are cached in your
            browser.
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
            or send a{" "}
            <Link
              href="https://twitter.com/glassmonekey"
              isExternal
              color="accent"
            >
              DM
            </Link>
            . Keep private information out of shared examples.
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
