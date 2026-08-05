import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Minimal Chrome DevTools Protocol client built on Node's global WebSocket and fetch,
 * so the screenshot pipeline needs no npm dependencies. Each page is driven through its
 * own target WebSocket, which keeps the connection valid across renderer swaps.
 */

const DEVTOOLS_PATTERN = /DevTools listening on (ws:\/\/\S+)/;

export const BROWSER_FLAGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-client-side-phishing-detection",
  "--disable-domain-reliability",
  "--disable-sync",
  "--disable-features=Translate,MediaRouter,OptimizationHints",
  "--metrics-recording-only",
  "--no-service-autorun",
  "--password-store=basic",
  "--use-mock-keychain",
  "--force-device-scale-factor=1",
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
];

export function findBrowser() {
  const candidates = [];
  if (process.env.CHROME_PATH) {
    candidates.push(process.env.CHROME_PATH);
  }

  [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter(Boolean)
    .forEach((base) => {
      candidates.push(
        path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(base, "Chromium", "Application", "chrome.exe"),
        path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    });

  const playwrightRoot = process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
      : path.join(os.homedir(), ".cache", "ms-playwright");
  if (existsSync(playwrightRoot)) {
    readdirSync(playwrightRoot)
      .filter((entry) => entry.startsWith("chromium-"))
      .sort()
      .reverse()
      .forEach((entry) => {
        candidates.push(
          path.join(playwrightRoot, entry, "chrome-win64", "chrome.exe"),
          path.join(playwrightRoot, entry, "chrome-linux", "chrome"),
          path.join(playwrightRoot, entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        );
      });
  }

  candidates.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  );

  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error([
      "No Chromium-family browser was found, so no screenshots were captured.",
      "Install Google Chrome, Microsoft Edge, or Chromium, or set CHROME_PATH to a browser executable.",
      "Screenshots are never synthesized: this script only captures real renders.",
    ].join("\n"));
  }
  return found;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpSocket {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (message.id === undefined) {
        return;
      }
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!entry) {
        return;
      }
      if (message.error) {
        entry.reject(new Error(`${entry.method} failed: ${message.error.message}`));
      } else {
        entry.resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return withTimeout(
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, method });
        this.socket.send(JSON.stringify({ id, method, params }));
      }),
      30000,
      `Timed out waiting for CDP response to ${method}.`,
    );
  }

  close() {
    this.socket.close();
  }
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await withTimeout(new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`Failed to connect to ${endpoint}.`)), { once: true });
  }), 30000, `Timed out connecting to ${endpoint}.`);
  return new CdpSocket(socket);
}

export async function launchBrowser(executablePath, profileDirectory, extraFlags = []) {
  if (typeof WebSocket === "undefined") {
    throw new Error("This Node.js runtime has no global WebSocket; Node 22 or newer is required to drive a browser.");
  }

  const isHeadlessShell = /headless[-_]shell/i.test(path.basename(executablePath));
  const flags = isHeadlessShell
    ? BROWSER_FLAGS.filter((flag) => !flag.startsWith("--headless"))
    : BROWSER_FLAGS;

  const child = spawn(executablePath, [
    ...flags,
    ...extraFlags,
    `--user-data-dir=${profileDirectory}`,
    "--remote-debugging-port=0",
    // chrome-headless-shell treats a positional URL as a one-shot headless command,
    // which is incompatible with remote debugging.
    ...(isHeadlessShell ? [] : ["about:blank"]),
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  const browserEndpoint = await withTimeout(new Promise((resolve, reject) => {
    let buffered = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
      buffered += text;
      const match = DEVTOOLS_PATTERN.exec(buffered);
      if (match) {
        resolve(match[1]);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Browser exited early with code ${code}.\n${buffered}`)));
  }), 60000, "Timed out waiting for the browser DevTools endpoint.");

  const { host } = new URL(browserEndpoint.replace(/^ws:/, "http:"));
  const httpBase = `http://${host}`;

  return {
    httpBase,
    async close() {
      try {
        const socket = await connect(browserEndpoint);
        await socket.send("Browser.close").catch(() => undefined);
        socket.close();
      } catch {
        child.kill();
      }
      await new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

async function openTarget(httpBase, url) {
  const endpoint = `${httpBase}/json/new?${encodeURIComponent(url)}`;
  for (const method of ["PUT", "GET"]) {
    const response = await fetch(endpoint, { method });
    if (response.ok) {
      return response.json();
    }
  }
  throw new Error(`Unable to open a DevTools target for ${url}.`);
}

/**
 * Opens `url` at exactly `width` x `height` and hands back an evaluation handle, so
 * callers can measure real layout in a real engine instead of guessing at it.
 */
export async function openPage(browser, { url, width, height }) {
  const target = await openTarget(browser.httpBase, url);
  const page = await connect(target.webSocketDebuggerUrl);

  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });

  const evaluate = async (expression) => {
    const evaluation = await page.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluation.exceptionDetails) {
      const details = evaluation.exceptionDetails;
      throw new Error(details.exception?.description ?? details.text ?? "Page evaluation threw.");
    }
    return evaluation.result?.value;
  };

  return {
    evaluate,
    async waitForReady(expression, timeoutMs = 30000) {
      const deadline = Date.now() + timeoutMs;
      let state;
      do {
        state = await evaluate(expression);
        if (state?.error) {
          throw new Error(`Probe page reported an error: ${state.error}`);
        }
        if (state?.ready) {
          return state;
        }
        await delay(50);
      } while (Date.now() < deadline);
      throw new Error(`Page never reached the ready state: ${url}\n${JSON.stringify(state)}`);
    },
    async close() {
      page.close();
      await fetch(`${browser.httpBase}/json/close/${target.id}`).catch(() => undefined);
    },
  };
}

/**
 * Renders `url` at exactly `width` x `height` and returns the PNG bytes plus whatever
 * `readyExpression` evaluated to, so callers can prove the page really rendered.
 */
export async function capturePage(browser, { url, width, height, readyExpression, readyTimeoutMs = 30000, transparent = false }) {
  const target = await openTarget(browser.httpBase, url);
  const page = await connect(target.webSocketDebuggerUrl);

  try {
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    if (transparent) {
      await page.send("Emulation.setDefaultBackgroundColorOverride", {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
    }

    let state;
    const deadline = Date.now() + readyTimeoutMs;
    do {
      const evaluation = await page.send("Runtime.evaluate", {
        expression: readyExpression,
        returnByValue: true,
        awaitPromise: true,
      });
      state = evaluation.result?.value;
      if (state?.error) {
        throw new Error(`Harness reported an error: ${state.error}`);
      }
      if (state?.ready) {
        break;
      }
      await delay(100);
    } while (Date.now() < deadline);

    if (!state?.ready) {
      throw new Error(`Page never reached the ready state: ${url}\n${JSON.stringify(state)}`);
    }

    const { data } = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });

    return { buffer: Buffer.from(data, "base64"), state };
  } finally {
    page.close();
    await fetch(`${browser.httpBase}/json/close/${target.id}`).catch(() => undefined);
  }
}
