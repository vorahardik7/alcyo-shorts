// End-to-end tests against the built app (pnpm build first), or a packaged
// executable when ALCYO_E2E_EXECUTABLE is set.
import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { command, type Launched, launch } from "./launch";

let run: Launched;
let page: Page;

test.beforeAll(async () => {
  run = await launch("pass");
  page = run.page;
  await page.getByTestId("sidebar").waitFor();
});

test.afterAll(async () => {
  await run.close();
});

const hash = () => page.evaluate(() => window.location.hash);

test("opens to the chat shell with an empty sidebar", async () => {
  const testInfo = test.info();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("empty-streams")).toContainText("No streams yet");
  await expect(page.getByTestId("empty-thread")).toBeVisible();
  await expect(page.getByPlaceholder("Paste a stream link or drop a recording")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("shell.png") });
});

test("the renderer has no require or process, and window.alcyo has only invoke and on", async () => {
  const globals = await page.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    return {
      require: typeof g["require"],
      process: typeof g["process"],
      module: typeof g["module"],
      Buffer: typeof g["Buffer"],
      bridge: Object.keys(window.alcyo).sort(),
    };
  });
  expect(globals).toEqual({
    require: "undefined",
    process: "undefined",
    module: "undefined",
    Buffer: "undefined",
    bridge: ["invoke", "on"],
  });
});

test("the window uses the CSP from the plan", async () => {
  const csp = await page.evaluate(
    () =>
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content") ?? "",
  );
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("worker-src 'self' blob:");
});

// The typed bridge rejects these calls at compile time; the test sends them
// anyway to show the runtime checks.
type LooseBridge = { invoke(channel: string, input: unknown): Promise<unknown> };

test("main rejects unknown channels and bad input", async () => {
  const unknown = await page.evaluate(() =>
    (window.alcyo as unknown as LooseBridge).invoke("fs:read", {}).then(
      () => "resolved",
      (e: unknown) => String(e),
    ),
  );
  expect(unknown).toContain("Unknown channel");
  const bad = await page.evaluate(() =>
    (window.alcyo as unknown as LooseBridge).invoke("worker:ping", { text: 5 }).then(
      () => "resolved",
      (e: unknown) => String(e),
    ),
  );
  expect(bad).toContain("bad input");
});

test("a message round-trips through the utilityProcess worker", async () => {
  const reply = await page.evaluate(() =>
    window.alcyo.invoke("worker:ping", { text: "hello worker" }),
  );
  expect(reply.text).toBe("hello worker");
  expect(reply.ms).toBeGreaterThanOrEqual(0);
});

test("macOS open-url routes a link to the renderer", async () => {
  await run.app.evaluate(({ app: electronApp }) => {
    electronApp.emit(
      "open-url",
      { preventDefault: () => undefined },
      "alcyo://s/abc/short/sh1/v/2",
    );
  });
  await expect.poll(hash).toBe("#/s/abc/short/sh1/v/2");
  await expect(page.getByTestId("stream-placeholder")).toHaveText("That stream isn't in this app.");
});

test("Windows second-instance argv routes a link to the renderer", async () => {
  await run.app.evaluate(({ app: electronApp }) => {
    electronApp.emit(
      "second-instance",
      {},
      [
        "C:\\Program Files\\Alcyo Shorts\\Alcyo Shorts.exe",
        "--allow-file-access-from-files",
        "alcyo://settings/about/",
      ],
      "C:\\",
    );
  });
  await expect.poll(hash).toBe("#/settings/about");
  await expect(page.getByTestId("notices")).toContainText("FFmpeg");
});

test("a malformed link shows the plain message", async () => {
  await run.app.evaluate(({ app: electronApp }) => {
    electronApp.emit("open-url", { preventDefault: () => undefined }, "alcyo://s/abc/nowhere");
  });
  await expect(page.getByTestId("link-notice")).toContainText(
    "That link doesn't point to anything in this app.",
  );
});

test("a second instance exits and hands its link to the first", async () => {
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  const second = spawn(command.executable, [...command.args, "alcyo://renders"], {
    env: run.env,
    stdio: "ignore",
  });
  const code = await new Promise<number | null>((resolve) => second.once("exit", resolve));
  expect(code).toBe(0);
  await expect.poll(hash).toBe("#/renders");
  await expect(page.getByTestId("render-queue")).toContainText("No renders yet");
});
