// Regression coverage for the audited transitions, with synthetic footage and
// a scripted agent. No user projects, login or billed calls are touched.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { launch, type Launched, showInvisibly } from "./launch";
import { seed, sourceId, streamId } from "./seed";

const mod = process.platform === "darwin" ? "Meta" : "Control";
let run: Launched;
let page: Page;
let userData: string;
let folder: string;
let shortId: string;
const edit = async (version: number) => {
  await page.evaluate(
    ({ s, id, n }) => {
      location.hash = `/s/${s}/short/${id}/v/${n}/edit`;
    },
    { s: streamId, id: shortId, n: version },
  );
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", String(version));
};
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "alcyo-audit-e2e-"));
  folder = seed(userData);
  appendFileSync(
    join(folder, "thread", "messages.jsonl"),
    JSON.stringify({
      id: "m_legacyjob",
      rev: 0,
      at: "2026-11-01T12:00:00.000Z",
      author: "app",
      body: {
        kind: "status",
        jobId: "job_legacy",
        label: "Making a preview",
        pct: 75,
        state: "running",
      },
    }) + "\n",
  );
  run = await launch("pass", {
    ALCYO_TEST_AGENT: "script",
    ALCYO_USER_DATA: userData,
    ALCYO_STREAMS_DIR: join(userData, "Streams"),
  });
  page = run.page;
  await showInvisibly(run.app);
  await page.getByTestId("stream-row").filter({ hasText: "Boss Fight Stream" }).click();
  await page.getByTestId("find-shorts").click();
  const cards = page.getByTestId("shorts-message").getByTestId("short-card");
  // Every card, so first() is short 1 and not whichever preview loaded first.
  await expect(cards).toHaveCount(3, { timeout: 15_000 });
  const card = cards.first();
  await expect(card).toBeVisible();
  shortId = (await card.getAttribute("data-short-id"))!;
});
test.afterAll(async () => {
  await run.close();
  rmSync(userData, { recursive: true, force: true });
});

test("legacy interrupted analysis stays resumable even when its transcript already exists", async () => {
  await expect(page.getByTestId("resume-analysis")).toHaveText("Resume analysis");
  await expect(page.getByTestId("status-message")).toHaveAttribute("data-state", "failed");
});

test("undo to clean cancels the pending autosave", async () => {
  await edit(1);
  await page.getByTestId("panel-captions").click();
  await page.getByTestId("wpl-2").click();
  await page.keyboard.press(`${mod}+z`);
  await expect(page.getByTestId("save-version")).toBeDisabled();
  // Cross the 300 ms debounce: an immediate null read would miss the bug.
  await page.waitForTimeout(450);
  const result = await page.evaluate(
    ({ streamId, shortId }) => window.alcyo.invoke("short:get", { streamId, shortId }),
    { streamId, shortId },
  );
  expect(result.draft).toBeNull();
});

test("scrubbing after a cut keeps playback and pauses the hidden video", async () => {
  const saved = await page.evaluate(
    async ({ streamId, shortId }) => {
      const { version } = await window.alcyo.invoke("short:get", { streamId, shortId });
      const { hook: _hook, ...short } = version.short;
      return window.alcyo.invoke("short:saveVersion", {
        streamId,
        shortId,
        short: {
          ...short,
          crop: { keys: [{ t: 0, x: 0.9, ease: "hold" }] },
          segments: [
            { srcIn: 0, srcOut: 1000 },
            { srcIn: 5000, srcOut: 10000 },
          ],
        },
        note: "Two cuts",
      });
    },
    { streamId, shortId },
  );
  await edit(saved.version);
  await expect
    .poll(() => page.getByTestId("player-video").evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await page.getByTestId("editor-play").click();
  const videos = page.locator('[data-testid="short-player"] video');
  await expect
    .poll(() =>
      videos.evaluateAll((vs) =>
        vs.map((v) => ({
          visible: (v as HTMLElement).style.visibility,
          paused: (v as HTMLVideoElement).paused,
        })),
      ),
    )
    .toMatchObject([
      { visible: "hidden", paused: true },
      { visible: "visible", paused: false },
    ]);
  const ruler = (await page.getByTestId("ruler").boundingBox())!;
  await page.mouse.click(ruler.x + 16 + 3 * 32, ruler.y + 8);
  await expect.poll(() => page.getByTestId("editor-time").innerText()).toMatch(/^0:04/);
  await expect
    .poll(() =>
      videos.evaluateAll((vs) =>
        vs
          .filter((v) => (v as HTMLElement).style.visibility === "hidden")
          .every((v) => (v as HTMLVideoElement).paused),
      ),
    )
    .toBe(true);
  await page.getByTestId("editor-play").click();
});

test("an incoming URL loads another version of the same open editor", async () => {
  await edit(1);
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("/v/1/edit");
});

test("trimming beyond the loaded window fetches the additional transcript", async () => {
  await edit(1);
  await page.getByTestId("panel-transcript").click();
  await expect(page.getByTestId("word").filter({ hasText: /^word35$/ })).toHaveCount(0);
  for (let i = 0; i < 3; i++) await page.keyboard.press("-");
  const handle = page.getByTestId("timeline").getByTestId("trim-out").last();
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 800, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("save-version")).toBeEnabled();
  await expect(page.getByTestId("word").filter({ hasText: /^word35$/ })).toHaveCount(10);
  await page.keyboard.press(`${mod}+z`);
  await expect(page.getByTestId("save-version")).toBeDisabled();
});

test("replying to v1 branches from v1 after a different manual version", async () => {
  await page.evaluate(
    ({ streamId, shortId }) =>
      window.alcyo.invoke("chat:send", {
        streamId,
        text: "make it punchier",
        replyTo: { shortId, version: 1 },
      }),
    { streamId, shortId },
  );
  await expect
    .poll(() =>
      page.evaluate(
        async ({ streamId, shortId }) =>
          (await window.alcyo.invoke("short:get", { streamId, shortId })).version.version,
        { streamId, shortId },
      ),
    )
    .toBe(3);
  const version = await page.evaluate(
    async ({ streamId, shortId }) =>
      (await window.alcyo.invoke("short:get", { streamId, shortId })).version,
    { streamId, shortId },
  );
  expect(version.parent).toBe(1);
  expect(version.short.crop.keys[0]!.x).toBe(0.5);
});

test("restoring a version publishes a card and a working version link", async () => {
  await page.getByTestId("restore-version").click();
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "4");
  await page.evaluate(
    ({ streamId, shortId }) => {
      location.hash = `/s/${streamId}/short/${shortId}/v/4`;
    },
    { streamId, shortId },
  );
  await expect(page.locator('[data-testid="short-card"][data-version="4"]')).toBeVisible();
  await expect(page.getByTestId("short-not-found")).toHaveCount(0);
});

test("media readiness refreshes a mounted placeholder and its captions", async () => {
  const file = join(folder, "sources", sourceId, "source.json");
  const source = JSON.parse(readFileSync(file, "utf8")) as { probe: unknown };
  writeFileSync(file, JSON.stringify({ ...source, probe: null }));
  await page.evaluate(() => {
    location.hash = "/";
  });
  await page.getByTestId("stream-row").filter({ hasText: "Boss Fight Stream" }).click();
  await expect(
    page.getByText("The preview shows once the recording or its proxy is ready.").first(),
  ).toBeVisible();
  writeFileSync(file, JSON.stringify(source));
  await run.app.evaluate(
    ({ BrowserWindow }, payload) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send("source:changed", payload),
    { streamId, sourceId },
  );
  await expect(page.getByTestId("short-player").first()).toBeVisible();
  await expect(page.getByTestId("player-captions").first()).toHaveAttribute("data-ready", "true");
});

test("a version link outside the latest history page loads a bounded linked card", async () => {
  appendFileSync(
    join(folder, "thread", "messages.jsonl"),
    Array.from({ length: 250 }, (_, i) =>
      JSON.stringify({
        id: `m_audit${i}`,
        rev: 0,
        at: "2026-11-01T12:00:00.000Z",
        author: "user",
        body: { kind: "text", text: `Later message ${i}` },
      }),
    ).join("\n") + "\n",
  );
  await page.evaluate(() => {
    location.hash = "/";
  });
  await page.evaluate(
    ({ streamId, shortId }) => {
      location.hash = `/s/${streamId}/short/${shortId}/v/1`;
    },
    { streamId, shortId },
  );
  await expect(page.getByTestId("linked-message").getByTestId("short-card").first()).toBeVisible();
  await expect(page.getByTestId("short-not-found")).toHaveCount(0);
  expect(await page.getByTestId("message").count()).toBeLessThanOrEqual(201);
});

test("an explicit save failure preserves the latest edit across reopening", async () => {
  await edit(1);
  await run.app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as typeof ipcMain & {
        _invokeHandlers: Map<string, (event: unknown, raw: unknown) => unknown>;
      }
    )._invokeHandlers;
    const original = handlers.get("short:saveVersion")!;
    let fail = true;
    ipcMain.removeHandler("short:saveVersion");
    ipcMain.handle("short:saveVersion", (event, raw: unknown) => {
      if (fail) {
        fail = false;
        throw new Error("Transient version save failure");
      }
      return original(event, raw);
    });
  });
  await page.getByTestId("panel-captions").click();
  await page.getByTestId("wpl-2").click();
  await page.getByTestId("save-version").click();
  await expect(page.getByTestId("toast").filter({ hasText: "Couldn't save" })).toBeVisible();
  const draft = await page.evaluate(
    async ({ streamId, shortId }) =>
      (await window.alcyo.invoke("short:get", { streamId, shortId, version: 1 })).draft,
    { streamId, shortId },
  );
  expect(draft).toMatchObject({ baseVersion: 1, short: { captions: { wordsPerLine: 2 } } });
  await page.evaluate(() => {
    location.hash = "/";
  });
  await page.getByTestId("open-demo").waitFor();
  await edit(1);
  await expect(page.getByTestId("save-version")).toBeEnabled();
  // A successful retry saves the same edit, rather than leaving only a draft.
  await page.getByTestId("save-version").click();
  await expect(page.getByTestId("save-version")).toBeDisabled();
});

test("a delayed restore respects newer navigation and edits", async () => {
  await edit(1);
  await run.app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as typeof ipcMain & {
        _invokeHandlers: Map<string, (event: unknown, raw: unknown) => unknown>;
      }
    )._invokeHandlers;
    const original = handlers.get("short:restore")!;
    ipcMain.removeHandler("short:restore");
    ipcMain.handle("short:restore", async (event, raw: unknown) => {
      const result = await original(event, raw);
      await new Promise((resolve) => setTimeout(resolve, 800));
      return result;
    });
  });
  await page.getByTestId("restore-version").click();
  await edit(2);
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "2");
  await page.getByTestId("restore-version").click();
  await page.getByTestId("panel-captions").click();
  await page.getByTestId("wpl-2").click();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("editor")).toHaveAttribute("data-version", "2");
  await expect(page.getByTestId("save-version")).toBeEnabled();
});

test("a legacy partial proxy failure offers retry while keeping Find shorts available", async () => {
  const file = join(folder, "sources", sourceId, "source.json");
  const source = JSON.parse(readFileSync(file, "utf8")) as { probe: { playsDirectly: boolean } };
  writeFileSync(
    file,
    JSON.stringify({ ...source, probe: { ...source.probe, playsDirectly: false } }),
  );
  appendFileSync(
    join(folder, "thread", "messages.jsonl"),
    JSON.stringify({
      id: "m_partialold",
      rev: 0,
      at: new Date().toISOString(),
      author: "app",
      body: {
        kind: "status",
        jobId: "job_partialold",
        label: "Analysis finished, with problems",
        pct: 100,
        state: "done",
        jobKind: "analysis",
        targetId: sourceId,
      },
    }) + "\n",
  );
  // A fresh service session reconciles jobs written by the earlier build.
  await run.close();
  run = await launch("pass", {
    ALCYO_TEST_AGENT: "script",
    ALCYO_USER_DATA: userData,
    ALCYO_STREAMS_DIR: join(userData, "Streams"),
  });
  page = run.page;
  await page.getByTestId("stream-row").filter({ hasText: "Boss Fight Stream" }).click();
  await expect(
    page.getByRole("button", { name: "Resume analysis", exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByTestId("find-shorts")).toBeVisible();
  writeFileSync(file, JSON.stringify(source));
});
