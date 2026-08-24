// Driver for the issue #29 ruby.wasm capability probe.
//
// Owns the probe list, the per-probe deadline and the terminate/recreate
// recovery, because a wedged VM cannot report its own wedge. Renders a plain
// text log so the run can be read straight off the page.
import { PROBES } from "./capability-probes.js";

const out = document.getElementById("out");
const status = document.getElementById("status");

const DEFAULT_TIMEOUT_MS = 8000;

// Which ruby.wasm build to survey. The app ships the stdlib-less
// dist/ruby.wasm; the same npm package also ships dist/ruby+stdlib.wasm, and
// what is or is not require-able differs between the two, so the build is a
// parameter of the survey rather than a constant.
const WASM_URL = new URLSearchParams(location.search).get("wasm") || "/ruby-wasm/ruby.wasm";

let worker = null;
let pending = null;
let bootCount = 0;

function log(line = "") {
  out.textContent += line + "\n";
}

function ms(v) {
  return `${v.toFixed(1)}ms`;
}

function spawnWorker() {
  const w = new Worker("./capability-probe.worker.js", { type: "module" });
  w.onmessage = (event) => {
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(event.data);
    }
  };
  w.onerror = (event) => {
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve({ ok: false, error: `worker error: ${event.message}` });
    }
  };
  return w;
}

// Resolves with the worker's reply, or with {timedOut: true} once the deadline
// passes. The caller decides what to do with the wedged worker.
function send(message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    pending = finish;
    setTimeout(() => {
      if (!settled) {
        pending = null;
        finish({ timedOut: true });
      }
    }, timeoutMs);
    worker.postMessage(message);
  });
}

async function bootWorker() {
  const t0 = performance.now();
  worker = spawnWorker();
  const reply = await send({ type: "boot", wasmUrl: WASM_URL }, 60000);
  const wallMs = performance.now() - t0;
  bootCount += 1;
  return { reply, wallMs };
}

async function main() {
  log("=== issue #29 ruby.wasm capability probe ===");
  log(`user agent: ${navigator.userAgent}`);
  log(`started: ${new Date().toISOString()}`);
  log(`wasm under test: ${WASM_URL}`);
  log();

  status.textContent = "booting ruby.wasm...";
  let boot = await bootWorker();
  if (boot.reply.timedOut || !boot.reply.ok) {
    status.textContent = "BOOT FAILED";
    log(`BOOT FAILED: ${JSON.stringify(boot.reply)}`);
    return;
  }

  log("--- D. VM ライフサイクル実測 (cold boot #1) ---");
  const t = boot.reply.timings;
  log(`ruby.wasm bytes: ${t.bytes}`);
  log(`fetch: ${ms(t.fetchMs)}`);
  log(`WebAssembly.compile: ${ms(t.compileMs)}`);
  log(`DefaultRubyVM (VM init): ${ms(t.vmInitMs)}`);
  log(`worker-side total: ${ms(t.totalMs)}`);
  log(`main-thread wall (Worker ctor -> ready): ${ms(boot.wallMs)}`);
  log();

  // Warm baseline so the per-probe numbers below have something to sit against.
  const warm = [];
  for (let i = 0; i < 20; i += 1) {
    const reply = await send({ type: "eval", id: `warm${i}`, code: "1 + 1" }, DEFAULT_TIMEOUT_MS);
    if (reply.ok) warm.push(reply.ms);
  }
  if (warm.length) {
    const avg = warm.reduce((a, b) => a + b, 0) / warm.length;
    log(`warm vm.eval("1 + 1") x${warm.length}: avg ${ms(avg)}, min ${ms(Math.min(...warm))}, max ${ms(Math.max(...warm))}`);
  }
  log();

  let currentGroup = null;
  for (const probe of PROBES) {
    if (probe.group !== currentGroup) {
      currentGroup = probe.group;
      log(`--- ${currentGroup} ---`);
      log();
    }

    status.textContent = `running: ${probe.id}`;
    const timeoutMs = probe.timeoutMs || DEFAULT_TIMEOUT_MS;
    const reply = await send({ type: "eval", id: probe.id, code: probe.code }, timeoutMs);

    log(`[${probe.id}] ${probe.label}`);
    log(`  問い: ${probe.question}`);

    if (reply.timedOut) {
      log(`  RESULT: HUNG (no reply within ${timeoutMs}ms)${probe.hangRisk ? " -- hang was an expected outcome here" : ""}`);
      worker.terminate();
      status.textContent = `recovering after ${probe.id}...`;
      const reboot = await bootWorker();
      if (reboot.reply.timedOut || !reboot.reply.ok) {
        log(`  RECOVERY FAILED: ${JSON.stringify(reboot.reply)}`);
        status.textContent = "RECOVERY FAILED";
        return;
      }
      log(`  RECOVERY: terminate + fresh worker + VM ready in ${ms(reboot.wallMs)} (boot #${bootCount}, wasm now in HTTP cache)`);
    } else if (!reply.ok) {
      log(`  RESULT: ERROR after ${reply.ms === undefined ? "?" : ms(reply.ms)}`);
      String(reply.error).split("\n").forEach((l) => log(`    ${l}`));
    } else {
      log(`  RESULT: ok in ${ms(reply.ms)}`);
      String(reply.result).split("\n").forEach((l) => log(`    ${l}`));
    }

    // A probe that installs a TracePoint or traps a signal can leave the
    // persistent VM in a state that poisons every later probe (observed on the
    // first run of this survey), so those get thrown away with their worker.
    if (probe.isolate && !reply.timedOut) {
      worker.terminate();
      const reboot = await bootWorker();
      if (reboot.reply.timedOut || !reboot.reply.ok) {
        log(`  ISOLATION REBOOT FAILED: ${JSON.stringify(reboot.reply)}`);
        status.textContent = "REBOOT FAILED";
        return;
      }
      log(`  (isolated: worker discarded, fresh VM in ${ms(reboot.wallMs)})`);
    }
    log();
  }

  log("--- E. JS 側から WASI FS へファイルを注入できるか ---");
  log();
  for (const extraFileCount of [0, 500]) {
    status.textContent = `mount test (${extraFileCount} extra files)...`;
    const mount = await send({ type: "mount-test", id: `mount-${extraFileCount}`, extraFileCount }, 60000);
    if (mount.timedOut) {
      log(`mount test (${extraFileCount} extra files): HUNG`);
    } else if (!mount.ok) {
      log(`mount test (${extraFileCount} extra files): ERROR ${mount.error}`);
    } else {
      log(`mount test with ${extraFileCount} extra .rbs files:`);
      log(`  VM build + mount: ${ms(mount.timings.initMs)}, probe eval: ${ms(mount.timings.evalMs)}`);
      String(mount.timings.result).split("\n").forEach((l) => log(`  ${l}`));
    }
    log();
  }

  // Last, because it doubles the worker's wasm memory footprint and we would
  // rather lose this number than any of the probes above.
  log("--- D. VM ライフサイクル実測 (同一 Worker 内で 2 個目の VM) ---");
  log();
  status.textContent = "measuring second VM...";
  const second = await send({ type: "second-vm", id: "second-vm" }, 60000);
  if (second.timedOut) {
    log("second VM: HUNG / OOM (no reply within 60000ms)");
  } else if (!second.ok) {
    log(`second VM: ERROR ${second.error}`);
  } else {
    log(`second DefaultRubyVM from the already-compiled module: ${ms(second.timings.vmInitMs)}`);
    log(`its first eval("1 + 1"): ${ms(second.timings.firstEvalMs)} -> ${second.timings.firstEvalResult}`);
  }
  log();

  log(`worker boots during this run: ${bootCount}`);
  log("=== DONE ===");
  status.textContent = "DONE";
}

main().catch((err) => {
  status.textContent = "DRIVER CRASHED";
  log(`DRIVER CRASHED: ${err && err.stack ? err.stack : err}`);
});
