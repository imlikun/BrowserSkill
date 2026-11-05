// Exercise the built CLI, daemon and extension in an isolated browser profile.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { withChrome } from "../snapshot-coordinates/chrome.mjs";

// Only literal, unambiguous build-time endpoints are acceptable. This is a
// deliberately conservative bundle-format check, not a JavaScript evaluator.
function isolatedEndpoint(background, configuredPort) {
  assert(/^[1-9]\d{0,4}$/.test(configuredPort ?? ""), "set BSK_IDENTITY_PORT explicitly");
  const port = Number(configuredPort);
  assert(port <= 65535 && port !== 52800, "invalid or shared default daemon port");
  const literals = [...background.matchAll(/([`"'])(wss?:\/\/[^`"'\s\\]*)\1/g)].map((m) => m[2]);
  const urls = new Set(literals);
  assert.equal(urls.size, 1, "extension bundle must contain exactly one literal WebSocket endpoint");
  const endpoint = [...urls][0];
  const quote = "[`\\\"']";
  const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert(new RegExp(`new\\s+URL\\(\\s*${quote}${escaped}${quote}\\s*\\)`).test(background),
    "cannot identify the bundle's build-time daemon endpoint");
  assert(new RegExp(`\\burl\\s*:\\s*${quote}${escaped}${quote}`).test(background),
    "cannot identify the bundle's transport endpoint");
  assert.equal(endpoint, `ws://127.0.0.1:${port}`, "extension endpoint must exactly match the isolated port");
  return port;
}

function fieldValue(fields, labels, description) {
  const matches = fields.filter(({ label }) => labels.includes(label));
  assert.equal(matches.length, 1, `toolbar must contain exactly one ${description} field`);
  return matches[0].value;
}

function requireVerifiedCliCapability(result) {
  assert.equal(result?.cli?.capabilities?.disable_skill_sync, true,
    "CLI does not advertise support for isolated skill-sync suppression");
}

function requireExtensionId(id) {
  assert(typeof id === "string" && /^[a-p]{32}$/.test(id),
    "CDP must provide a valid unpacked extension ID; refusing to guess");
  return id;
}

function findOwnedWorker(targets, extensionId) {
  const id = requireExtensionId(extensionId);
  const url = `chrome-extension://${id}/background.js`;
  const matches = targets.filter((target) => target.type === "service_worker" && target.url === url);
  assert(matches.length <= 1, "owned extension worker must be unique");
  return matches[0];
}

async function evaluateWorker(send, sessionId, expression, awaitPromise, label) {
  try {
    const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }, sessionId);
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } catch (error) {
    throw new Error(`${label} failed: ${error.message}`, { cause: error });
  }
}

async function verifyWorkerRuntimeId(send, sessionId, extensionId) {
  const id = requireExtensionId(extensionId);
  const actual = await evaluateWorker(send, sessionId, "chrome.runtime.id", false, "worker runtime ID evaluation");
  assert.equal(actual, id, "worker runtime ID does not match loaded extension ID");
}

// Does not execute a CLI, open sockets, create files, or launch a browser.
if (process.argv.includes("--self-test")) {
  const bundle = (url) => `const base=new URL(\`${url}\`); const cfg={url:\`${url}\`};`;
  assert.equal(isolatedEndpoint(bundle("ws://127.0.0.1:52836"), "52836"), 52836);
  for (const [source, port] of [
    [bundle("ws://127.0.0.1:528360"), "52836"],
    [bundle("ws://127.0.0.1:52836/path"), "52836"],
    [bundle("ws://127.0.0.1:52836"), undefined],
    [bundle("ws://127.0.0.1:52800"), "52800"],
    [`${bundle("ws://127.0.0.1:52836")}; ${bundle("ws://127.0.0.1:52837")}`, "52836"],
    ["const decoy=`ws://127.0.0.1:52836`", "52836"],
  ]) assert.throws(() => isolatedEndpoint(source, port));
  const fields = [{ label: "Window ID", value: "42" }, { label: "Tab ID", value: "142" }];
  assert.equal(fieldValue(fields, ["Window ID"], "window"), "42");
  assert.equal(fieldValue(fields, ["Tab ID"], "tab"), "142");
  assert.throws(() => fieldValue([...fields, fields[0]], ["Window ID"], "window"));
  assert.throws(() => fieldValue(fields, ["missing"], "window"));
  requireVerifiedCliCapability({ cli: { capabilities: { disable_skill_sync: true } } });
  for (const result of [null, {}, { cli: {} }, { cli: { capabilities: { disable_skill_sync: false } } }]) {
    assert.throws(() => requireVerifiedCliCapability(result));
  }
  const id = "a".repeat(32);
  const owned = { type: "service_worker", url: `chrome-extension://${id}/background.js`, targetId: "owned" };
  const other = { type: "service_worker", url: `chrome-extension://${"b".repeat(32)}/background.js` };
  assert.equal(findOwnedWorker([other, owned], id), owned);
  assert.equal(findOwnedWorker([other, { ...owned, url: `${owned.url}?other` }], id), undefined);
  assert.throws(() => findOwnedWorker([owned, owned], id), /unique/);
  for (const invalid of [undefined, "", "z".repeat(32), "a".repeat(31)]) {
    assert.throws(() => findOwnedWorker([other], invalid), /refusing to guess/);
  }
  const sendId = async (method, params, session) => {
    assert.equal(method, "Runtime.evaluate");
    assert.equal(session, "worker-session");
    assert.equal(params.expression, "chrome.runtime.id");
    assert.equal(params.awaitPromise, false);
    assert.equal(params.returnByValue, true);
    return { result: { value: id } };
  };
  await verifyWorkerRuntimeId(sendId, "worker-session", id);
  await assert.rejects(() => verifyWorkerRuntimeId(async () => ({ result: { value: "b".repeat(32) } }), "s", id), /does not match/);
  await assert.rejects(() => verifyWorkerRuntimeId(async () => { throw new Error("CDP timed out: Runtime.evaluate"); }, "s", id), /worker runtime ID evaluation failed: CDP timed out/);
  await assert.rejects(() => evaluateWorker(async () => { throw new Error("CDP timed out: Runtime.evaluate"); }, "s", "storage", true, "worker storage evaluation"), /worker storage evaluation failed: CDP timed out/);
  console.log("controller-identity offline self-test passed");
  process.exit(0);
}

const cli = process.env.BSK_IDENTITY_CLI;
const executable = process.env.BSK_IDENTITY_CHROME;
const extensionPath = resolve(
  process.env.BSK_IDENTITY_EXTENSION ?? "apps/extension/dist/chrome-mv3",
);
const portText = process.env.BSK_IDENTITY_PORT;
const extensionViaCdp = process.env.BSK_IDENTITY_EXTENSION_VIA_CDP !== "0";
assert(extensionViaCdp, "non-CDP extension loading cannot safely identify the owned extension; refusing to guess");
const output = resolve(
  process.env.BSK_IDENTITY_OUTPUT ?? "evals/browser/results/controller-identity",
);
assert(
  cli && executable,
  "Set BSK_IDENTITY_CLI and BSK_IDENTITY_CHROME to the built CLI and browser executable",
);
const manifest = JSON.parse(await readFile(join(extensionPath, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3, "expected a Manifest V3 extension");
const background = await readFile(join(extensionPath, "background.js"), "utf8");
const port = isolatedEndpoint(background, portText);

const localeRoot = resolve("packages/i18n/src/locales");
const localeEntries = await readdir(localeRoot, { withFileTypes: true });
const localeStrings = await Promise.all(localeEntries.filter((entry) => entry.isDirectory()).map(async (entry) =>
  JSON.parse(await readFile(join(localeRoot, entry.name, "extension.json"), "utf8"))));
const windowLabels = [...new Set(localeStrings.map((locale) => locale.controlOverlay.windowId))];
const tabLabels = [...new Set(localeStrings.map((locale) => locale.controlOverlay.tabId))];
assert(windowLabels.every((label) => typeof label === "string" && !tabLabels.includes(label)));
assert(tabLabels.every((label) => typeof label === "string"));
const home = await mkdtemp(join(tmpdir(), "bsk-controller-identity-"));
const env = {
  ...process.env,
  BSK_HOME: home,
  BSK_AUTO_START: "0",
  BSK_AUTO_UPDATE: "off",
  BSK_DISABLE_SKILL_SYNC: "1",
  BSK_BROWSER_WAIT_MS: "0",
};
const execute = promisify(execFile);
const bsk = async (...args) => {
  const { stdout } = await execute(cli, [...args, "--json"], {
    env,
    windowsHide: true,
    timeout: 30000,
  });
  return JSON.parse(stdout);
};
const until = async (probe, label) => {
  const deadline = Date.now() + 15000;
  do {
    const result = await probe();
    if (result) return result;
    await new Promise((done) => setTimeout(done, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
};
let daemon;
let daemonLog = "";
const sessions = new Set();
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    "<!doctype html><title>Controller identity regression</title><style>body{font:16px system-ui;margin:64px;color:#302820;background:#faf9f6}h1{font-size:28px}</style><h1>BrowserSkill controller identity</h1><p>Isolated regression using the production CLI, daemon and extension.</p><input aria-label='Draft' value='User draft'>",
  );
});
try {
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "result.json"),
    `${JSON.stringify({ passed: false, state: "running", startedAt: new Date().toISOString() })}\n`,
  );
  // This offline command returns before daemon discovery or skill synchronization.
  // Refuse older trusted binaries that do not support this test's isolation flag.
  requireVerifiedCliCapability(await bsk("debug", "capabilities"));
  // Chromium may modify _metadata while loading an unpacked extension. Always
  // load a private copy; never pass an installed extension directory to Chrome.
  const isolatedExtensionPath = join(home, "extension");
  await cp(extensionPath, isolatedExtensionPath, { recursive: true, dereference: true, errorOnExist: true, force: false });
  JSON.parse(await readFile(join(isolatedExtensionPath, "manifest.json"), "utf8"));
  isolatedEndpoint(await readFile(join(isolatedExtensionPath, "background.js"), "utf8"), portText);
  daemon = spawn(cli, ["daemon", "start", "--foreground", "--port", String(port)], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  daemon.stdout.on("data", (data) => {
    daemonLog += data;
  });
  daemon.stderr.on("data", (data) => {
    daemonLog += data;
  });
  await until(
    () =>
      access(join(home, "daemon.json")).then(
        () => true,
        () => false,
      ),
    "isolated daemon",
  );
  const daemonInfo = JSON.parse(await readFile(join(home, "daemon.json"), "utf8"));
  assert.equal(daemonInfo.pid, daemon.pid, "daemon PID must belong to this test");
  assert.equal(daemonInfo.ws_port, port, "daemon must use the isolated port");
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  await withChrome(
    {
      executable,
      extensionPath: isolatedExtensionPath,
      extensionViaCdp,
      headless: process.env.BSK_IDENTITY_HEADFUL !== "1",
      deviceScale: 1,
      zoom: 1,
    },
    async (send, { extensionId }) => {
      requireExtensionId(extensionId);
      const worker = await until(
        async () => findOwnedWorker((await send("Target.getTargets")).targetInfos, extensionId),
        "owned extension worker",
      );
      // Select only the browser launched by withChrome, not another extension
      // that happens to connect to this daemon's port.
      const workerSession = await send("Target.attachToTarget", {
        targetId: worker.targetId,
        flatten: true,
      });
      await verifyWorkerRuntimeId(send, workerSession.sessionId, extensionId);
      const instanceId = await until(
        () => evaluateWorker(
          send,
          workerSession.sessionId,
          '(async () => (await chrome.storage.local.get("bsk_instance_id")).bsk_instance_id)()',
          true,
          "worker storage evaluation",
        ),
        "owned browser instance ID from worker storage",
      );
      const browser = await until(async () => {
        const status = await bsk("status");
        assert(status.browsers.every((entry) => entry.instance_id === instanceId),
          "unexpected browser connected to the isolated daemon");
        return status.browsers.find((entry) => entry.instance_id === instanceId);
      }, "owned extension connection");
      const start = async (labels) => {
        const token = `${Date.now() + 120000}:${randomUUID()}`;
        await bsk("session", "request", token, "--prepare");
        const session = await bsk(
          "session",
          "start",
          "--browser",
          browser.instance_id,
          "--request-id",
          token,
          ...labels,
        );
        sessions.add(session.session_id);
        await bsk("session", "request", token, "--claim");
        assert(Number.isSafeInteger(session.agent_window_id) && session.agent_window_id >= 0,
          "session must report a valid window ID");
        const pageUrl = `${url}/${session.session_id}`;
        await bsk("navigate", pageUrl, "--session", session.session_id);
        // Query only our freshly launched browser's extension, then require a
        // unique match in this session's Agent Window. Return IDs only.
        const tabResult = await send("Runtime.evaluate", {
          expression: `(async () => (await chrome.tabs.query({windowId:${session.agent_window_id}}))
            .filter(t => t.url === ${JSON.stringify(pageUrl)}).map(t => ({id:t.id,windowId:t.windowId})))()`,
          awaitPromise: true,
          returnByValue: true,
        }, workerSession.sessionId);
        assert(!tabResult.exceptionDetails, "owned browser tab query failed");
        const tabs = tabResult.result.value;
        assert(Array.isArray(tabs) && tabs.length === 1, "controlled tab must be uniquely identifiable");
        assert(Number.isSafeInteger(tabs[0].id) && tabs[0].id >= 0, "controlled tab ID unavailable");
        assert.equal(tabs[0].windowId, session.agent_window_id, "controlled tab window mismatch");
        const { targetInfos } = await send("Target.getTargets");
        const targets = targetInfos.filter((entry) => entry.type === "page" && entry.url === pageUrl);
        assert.equal(targets.length, 1, "session page target must be unique");
        const target = targets[0];
        const attached = await send("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true,
        });
        const evaluate = async (expression) => {
          const result = await send(
            "Runtime.evaluate",
            { expression, returnByValue: true },
            attached.sessionId,
          );
          assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
          return result.result.value;
        };
        const overlay = () =>
          evaluate(`(() => {
        const root = document.querySelector('[data-bsk-overlay]')?.shadowRoot;
        const card = root?.querySelector('[role=toolbar]');
        if (!card) return null;
        const marker = card.querySelector('.bsk-controller-color');
        const badge = card.querySelector('.bsk-cooperation-badge');
        const primary = card.querySelector('.bsk-cooperation-primary');
        const rect = card.getBoundingClientRect();
        const fields = [...card.querySelectorAll('.bsk-controller-details > div')].map(row => ({
          label: row.querySelector(':scope > dt')?.textContent?.trim(),
          value: row.querySelector(':scope > dd')?.textContent?.trim()
        }));
        // Do not return or persist the URL/title; only return leak booleans.
        const exposed = [card.textContent, ...[card, ...card.querySelectorAll('*')]
          .flatMap(node => [...node.attributes].map(attr => attr.value))].join(' ');
        return {text: card.textContent, fields, color: marker && getComputedStyle(marker).backgroundColor,
          leaksUrl: exposed.includes(location.origin), leaksTitle: !!document.title && exposed.includes(document.title),
          fits: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && card.scrollWidth <= card.clientWidth,
          compact: !!badge && badge.clientHeight <= 24 && (!primary || primary.clientHeight <= 44)};
      })()`);
        await until(overlay, "control overlay");
        return { ...session, tabId: tabs[0].id, attached: attached.sessionId, evaluate, overlay };
      };
      const first = await start([
        "--agent-name",
        "Codex",
        "--project",
        "门店照片验证",
        "--controller-color",
        "#2563eb",
      ]);
      const second = await start(["--agent-name", "WorkBuddy", "--project", "商城联调"]);
      const legacy = await start([]);
      const assertTarget = (page, overlay) => {
        assert.equal(fieldValue(overlay.fields, windowLabels, "window"), String(page.agent_window_id),
          "toolbar window field must equal the session's Agent Window ID");
        assert.equal(fieldValue(overlay.fields, tabLabels, "tab"), String(page.tabId),
          "toolbar tab field must equal the controlled tab ID");
        assert(!overlay.leaksUrl && !overlay.leaksTitle, "toolbar must not expose the page URL or title");
      };
      const snapshots = [];
      for (const [page, name, project] of [
        [first, "Codex", "门店照片验证"],
        [second, "WorkBuddy", "商城联调"],
        [legacy, "BrowserSkill", ""],
      ]) {
        const overlay = await page.overlay();
        assert(overlay.text.includes(name));
        assert(overlay.text.includes(project));
        assert(overlay.text.includes(page.session_id));
        assertTarget(page, overlay);
        assert(overlay.fits, "toolbar must fit the viewport");
        const { data } = await send("Page.captureScreenshot", { format: "png" }, page.attached);
        await writeFile(join(output, `${name}.png`), Buffer.from(data, "base64"));
        snapshots.push({ sessionId: page.session_id, ...overlay });
      }
      assert.equal(snapshots[0].color, "rgb(37, 99, 235)");
      assert.notEqual(snapshots[0].color, snapshots[1].color);
      assert(!snapshots[0].text.includes("WorkBuddy"));
      assert(!snapshots[1].text.includes("Codex"));
      const status = await bsk("status");
      assert.equal(
        status.sessions.find((s) => s.session_id === first.session_id).controller.project,
        "门店照片验证",
      );
      assert.equal(
        status.sessions.find((s) => s.session_id === second.session_id).controller.name,
        "WorkBuddy",
      );
      assert.equal(
        status.sessions.find((s) => s.session_id === legacy.session_id).controller,
        undefined,
      );
      // A fresh content script must recover identity after navigation.
      const context = await bsk("cooperate", "sync", "--session", first.session_id);
      assert.equal(typeof context.context_id, "string");
      assert.equal(typeof context.observation_id, "string");
      await bsk(
        "navigate",
        `${url}/${first.session_id}?reload`,
        "--session",
        first.session_id,
        "--context",
        context.context_id,
        "--observation",
        context.observation_id,
      );
      const reloadedOverlay = await until(async () => {
        const overlay = await first.overlay();
        return overlay?.text.includes("门店照片验证") ? overlay : null;
      }, "identity after navigation");
      assertTarget(first, reloadedOverlay);
      // Check the constrained viewport with the actual extension stylesheet.
      await send(
        "Emulation.setDeviceMetricsOverride",
        { width: 320, height: 568, deviceScaleFactor: 1, mobile: false },
        first.attached,
      );
      assert((await first.overlay()).fits, "toolbar must fit a 320px viewport");
      const narrow = await send("Page.captureScreenshot", { format: "png" }, first.attached);
      await writeFile(join(output, "Codex-narrow.png"), Buffer.from(narrow.data, "base64"));
      const long = await start([
        "--agent-name",
        "Agent ".repeat(13),
        "--project",
        "项目".repeat(60),
      ]);
      await send(
        "Emulation.setDeviceMetricsOverride",
        { width: 320, height: 568, deviceScaleFactor: 1, mobile: false },
        long.attached,
      );
      const longOverlay = await long.overlay();
      assertTarget(long, longOverlay);
      assert(longOverlay.fits, "long labels must fit a 320px viewport");
      assert(longOverlay.compact, "long names must keep the badge and controls compact");
      const longScreenshot = await send("Page.captureScreenshot", { format: "png" }, long.attached);
      await writeFile(
        join(output, "Long-labels-narrow.png"),
        Buffer.from(longScreenshot.data, "base64"),
      );
      for (const id of [...sessions]) {
        await bsk("session", "stop", id);
        sessions.delete(id);
      }
      assert.equal((await bsk("status")).sessions.length, 0);
      await writeFile(
        join(output, "result.json"),
        `${JSON.stringify({ passed: true, snapshots }, null, 2)}\n`,
      );
      console.log(JSON.stringify({ passed: true, output, sessions: snapshots.length }));
    },
  );
} catch (error) {
  await writeFile(
    join(output, "result.json"),
    `${JSON.stringify({ passed: false, error: String(error), finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  throw error;
} finally {
  for (const id of sessions) await bsk("session", "stop", id).catch(() => {});
  if (daemon && daemon.exitCode === null) {
    // Stop only the child process we spawned; never issue a daemon-stop RPC.
    daemon.kill();
    await until(() => daemon.exitCode !== null || daemon.signalCode !== null, "daemon exit").catch(
      () => daemon.kill(),
    );
  }
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await writeFile(join(output, "daemon.log"), daemonLog);
  assert(home.startsWith(join(tmpdir(), "bsk-controller-identity-")));
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
