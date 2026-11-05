// Screenshots of the main screens at 1440 × 900, for design review rounds.
// Not part of test:e2e. Run after a build:
//   DESIGN_ROUND=r1 pnpm --filter @alcyo/desktop screens -g design
// Output: .agent-runs/screens/design-<round>/. Headless: nothing shows on screen.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, test } from "@playwright/test";
import { type Launched, launch, showInvisibly } from "./launch";

const round = process.env["DESIGN_ROUND"] ?? "r0";
const out = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".agent-runs",
  "screens",
  `design-${round}`,
);
mkdirSync(out, { recursive: true });

let run: Launched;
let page: Page;

async function size(w: number, h: number) {
  await run.app.evaluate(
    ({ BrowserWindow }, [width, height]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setContentSize(width!, height!);
    },
    [w, h],
  );
  await page.waitForTimeout(300);
}
async function go(route: string) {
  await page.evaluate((r) => {
    window.location.hash = `#${r}`;
  }, route);
  await page.waitForTimeout(400);
}
const shot = async (name: string) => {
  await showInvisibly(run.app);
  await page.screenshot({ path: join(out, `${name}.png`) });
};

test.describe("@screens design: main screens", () => {
  test.beforeAll(async () => {
    run = await launch("pass");
    page = run.page;
    await page.getByTestId("sidebar").waitFor();
    await size(1440, 900);
  });
  test.afterAll(async () => run.close());

  test("@screens design main", async () => {
    test.setTimeout(120_000);
    await go("/");
    await shot("01-home");

    await page.getByTestId("model-picker").click();
    await page.waitForTimeout(250);
    await shot("01b-model-picker");
    await page.getByRole("tab", { name: /Grok/ }).click();
    await page.waitForTimeout(150);
    await shot("01c-model-picker-unavailable");
    await page.keyboard.press("Escape");

    await page.getByTestId("open-demo").click();
    await page.getByTestId("stream-thread").waitFor();
    await page.waitForTimeout(800);
    const scroll = page.getByTestId("thread-scroll");
    await shot("02-thread-bottom");

    await page.getByTestId("shorts-message").scrollIntoViewIfNeeded();
    await page.getByTestId("shorts-message").getByTestId("short-card").first().waitFor();
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.querySelector('[data-testid="shorts-message"]')?.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(800);
    await shot("03-thread-shorts");

    await scroll.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(800);
    await shot("04-thread-top");

    // Reply state on a card.
    await page.getByTestId("shorts-message").getByTestId("reply-short").first().click();
    await page.waitForTimeout(300);
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);
    await shot("05-thread-replying");
    await page.keyboard.press("Escape");

    await page.getByTestId("attach").click();
    await page.waitForTimeout(250);
    await shot("06-attach-menu");
    await page.keyboard.press("Escape");

    await page.getByTestId("shorts-message").scrollIntoViewIfNeeded();
    await page.getByTestId("shorts-message").getByTestId("open-editor").first().click();
    await page.getByTestId("editor").waitFor();
    await page.waitForTimeout(2000);
    await shot("07-editor");

    await go("/renders");
    await shot("08-render-queue");
    await go("/settings/profile");
    await shot("09-settings-profile");
    await go("/settings/claude");
    await shot("10-settings-agents");
    await go("/onboarding");
    await page.waitForTimeout(300);
    await shot("11-onboarding");
    await go("/nowhere");
    await shot("12-not-found");

    await size(1100, 760);
    await go("/");
    await shot("13-home-small");
  });
});

test.describe("@screens design: first run", () => {
  test.beforeAll(async () => {
    run = await launch("fail");
    page = run.page;
    await page.getByTestId("setup").waitFor();
    await size(1440, 900);
  });
  test.afterAll(async () => run.close());

  test("@screens design setup", async () => {
    await page.waitForTimeout(400);
    await shot("20-setup");
    await page.getByTestId("skip-setup").click();
    await page.waitForTimeout(400);
    await shot("21-home-setup-incomplete");
  });
});
