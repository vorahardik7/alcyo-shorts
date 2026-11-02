// Screenshots of every screen, for review. Not part of test:e2e.
// Run: pnpm --filter @alcyo/desktop screens (after a build). Headless: nothing
// shows on screen. Output: .agent-runs/screens/pass2/.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Launched, launch } from "./launch";

const out = join(import.meta.dirname, "..", "..", "..", ".agent-runs", "screens", "pass2");
mkdirSync(out, { recursive: true });

let run: Launched;
let page: Page;

async function go(route: string) {
  await page.evaluate((r) => {
    window.location.hash = `#${r}`;
  }, route);
  await page.waitForTimeout(250);
}
const shot = (name: string) => page.screenshot({ path: join(out, `${name}.png`) });

test.describe("@screens fixture: setup complete", () => {
  test.beforeAll(async () => {
    run = await launch("pass");
    page = run.page;
    await page.getByTestId("sidebar").waitFor();
  });
  test.afterAll(async () => run.close());

  test("@screens every screen", async () => {
    await go("/");
    await shot("01-home");

    await page.getByTestId("new-stream").click();
    await page.getByTestId("composer-input").fill("https://www.twitch.tv/videos/2281");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toast")).toBeVisible();
    await page.waitForTimeout(250);
    await shot("02-home-link-toast");
    await page.keyboard.press("Escape");

    await page.getByTestId("attach").click();
    await page.waitForTimeout(200);
    await shot("03-composer-attach-menu");
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "stream.mp4", { type: "video/mp4" }));
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true }));
    });
    await page.waitForTimeout(200);
    await shot("04-drop-target");
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "stream.mp4", { type: "video/mp4" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true }));
    });
    await page.keyboard.press("Escape");

    await page.getByTestId("search-button").click();
    await page.getByTestId("search-input").fill("boss fight");
    await shot("05-sidebar-search");
    await page.keyboard.press("Escape");

    await page.getByTestId("render-queue-button").click();
    await page.waitForTimeout(300);
    await shot("06-render-queue");
    await page.keyboard.press("Escape");

    for (const [i, section] of [
      "profile",
      "claude",
      "models",
      "encoder",
      "storage",
      "about",
    ].entries()) {
      await go(`/settings/${section}`);
      await shot(`${String(10 + i).padStart(2, "0")}-settings-${section}`);
    }

    await go("/setup");
    await shot("20-setup-complete");

    await go("/s/my-stream");
    await shot("21-stream-placeholder");
    await go("/nowhere");
    await shot("22-not-found");
  });
});

test.describe("@screens fixture: setup incomplete", () => {
  test.beforeAll(async () => {
    run = await launch("fail");
    page = run.page;
    await page.getByTestId("setup").waitFor();
  });
  test.afterAll(async () => run.close());

  test("@screens first run opens to Setup", async () => {
    await page.waitForTimeout(300);
    await shot("30-first-run-setup-failing");
    await page.getByTestId("skip-setup").click();
    await page.waitForTimeout(250);
    await shot("31-home-setup-incomplete");
    await go("/settings/claude");
    await shot("32-settings-claude-missing");
  });
});

test.describe("@screens real checks on this computer", () => {
  test.beforeAll(async () => {
    run = await launch("real");
    page = run.page;
    await page.locator('[data-testid="sidebar"], [data-testid="setup"]').first().waitFor({
      timeout: 60_000,
    });
  });
  test.afterAll(async () => run.close());

  test("@screens real setup report", async () => {
    await go("/setup");
    await expect(page.getByTestId("setup-summary")).toBeVisible({ timeout: 60_000 });
    await shot("40-setup-real");
    for (const section of ["claude", "models", "encoder", "storage"]) {
      await go(`/settings/${section}`);
      await shot(`41-real-settings-${section}`);
    }
  });
});
