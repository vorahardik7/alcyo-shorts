// Navigation, empty states and the Setup gate (app-shell-polish).
import { expect, type Page, test } from "@playwright/test";
import { type Launched, launch } from "./launch";

const mod = process.platform === "darwin" ? "Meta" : "Control";

let run: Launched;
let page: Page;

const hash = () => page.evaluate(() => window.location.hash);
const title = () =>
  run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? "");

async function goHome() {
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  await expect.poll(hash).toBe("#/");
}

test.describe("with setup complete", () => {
  test.beforeAll(async () => {
    run = await launch("pass");
    page = run.page;
    await page.getByTestId("sidebar").waitFor();
  });
  test.afterAll(async () => {
    await run.close();
  });

  test("opens to home, not Setup, and names it in the title", async () => {
    await expect.poll(hash).toMatch(/^(#\/)?$/);
    await expect(page.getByTestId("empty-thread")).toBeVisible();
    await expect(page.getByTestId("setup-row")).toHaveCount(0);
    await expect.poll(title).toBe("New stream · Alcyo Shorts");
  });

  // Each destination is opened from the sidebar (or a screen it leads to), then
  // left with one of the three ways back. Every route is covered.
  const ways = ["button", "escape", "shortcut"] as const;
  async function goBack(way: (typeof ways)[number]) {
    if (way === "button") await page.getByTestId("back").first().click();
    else if (way === "escape") await page.keyboard.press("Escape");
    else await page.keyboard.press(`${mod}+BracketLeft`);
  }

  for (const way of ways) {
    test(`every settings section opens from the sidebar and ${way} returns`, async () => {
      await goHome();
      await page.getByTestId("settings-row").click();
      await expect.poll(hash).toBe("#/settings");
      await expect(page.getByTestId("screen-title")).toHaveText("Settings");
      await expect(page.getByTestId("settings-profile")).toBeVisible();
      await expect.poll(title).toBe("Settings · Profile · Alcyo Shorts");

      for (const section of ["claude", "models", "encoder", "storage", "about", "profile"]) {
        const before = await hash();
        await page.getByTestId(`section-${section}`).click();
        await expect.poll(hash).toBe(`#/settings/${section}`);
        await expect(page.getByTestId(`settings-${section}`)).toBeVisible();
        await goBack(way);
        await expect.poll(hash).toBe(before);
        await page.getByTestId(`section-${section}`).click();
        await expect.poll(hash).toBe(`#/settings/${section}`);
      }

      // Back out of Settings entirely: the history unwinds to home.
      await page.evaluate(() => window.history.go(-(window.history.length - 1)));
      await goHome();
    });
  }

  test("the creator header opens the profile; Back returns home", async () => {
    await goHome();
    await page.getByTestId("creator-header").click();
    await expect.poll(hash).toBe("#/settings/profile");
    await expect(page.getByTestId("profile-empty")).toContainText("No creator profile yet");
    await expect(page.getByTestId("comes-in").first()).toHaveText("Comes in spec 7");
    await page.getByTestId("back").click();
    await expect.poll(hash).toBe("#/");
  });

  test("Setup opens from Settings > Claude and Back returns there", async () => {
    await goHome();
    await page.getByTestId("settings-row").click();
    await page.getByTestId("section-claude").click();
    await page.getByTestId("open-setup").click();
    await expect.poll(hash).toBe("#/setup");
    await expect(page.getByTestId("sidebar")).toHaveCount(0);
    await expect(page.getByTestId("check-claude")).toHaveAttribute("data-state", "pass");
    await expect(page.getByTestId("continue")).toBeEnabled();
    await expect.poll(title).toBe("Setup · Alcyo Shorts");
    await page.getByTestId("back").click();
    await expect.poll(hash).toBe("#/settings/claude");
    await page.getByTestId("open-setup").click();
    await page.keyboard.press("Escape");
    await expect.poll(hash).toBe("#/settings/claude");
    await page.getByTestId("open-setup").click();
    await page.keyboard.press(`${mod}+BracketLeft`);
    await expect.poll(hash).toBe("#/settings/claude");
  });

  test("the grid button opens the render queue drawer; Esc, close and the button close it", async () => {
    await goHome();
    const button = page.getByTestId("render-queue-button");
    await button.click();
    await expect.poll(hash).toBe("#/renders");
    await expect(page.getByTestId("render-queue")).toContainText("No renders yet");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect.poll(title).toBe("Render queue · Alcyo Shorts");
    await page.keyboard.press("Escape");
    await expect.poll(hash).toBe("#/");
    await expect(page.getByTestId("render-queue")).toHaveCount(0);

    await button.click();
    await page.getByTestId("close-drawer").click();
    await expect.poll(hash).toBe("#/");

    await button.click();
    await expect.poll(hash).toBe("#/renders");
    await button.click();
    await expect.poll(hash).toBe("#/");
  });

  test("a stream route and an unknown route both lead back", async () => {
    await goHome();
    await page.evaluate(() => {
      window.location.hash = "#/s/abc/short/sh1/v/2/edit";
    });
    await expect(page.getByTestId("thread-header")).toHaveText("abc");
    await expect.poll(title).toBe("abc · Alcyo Shorts");
    await page.keyboard.press(`${mod}+BracketLeft`);
    await expect.poll(hash).toBe("#/");

    await page.evaluate(() => {
      window.location.hash = "#/nowhere/at/all";
    });
    await expect(page.getByTestId("not-found")).toBeVisible();
    await page.getByTestId("back").click();
    await expect.poll(hash).toBe("#/");

    await page.evaluate(() => {
      window.location.hash = "#/settings/nonsense";
    });
    await expect(page.getByTestId("not-found")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(hash).toBe("#/");
  });

  test("the mouse back and forward buttons and Cmd+] move through history", async () => {
    await goHome();
    await page.getByTestId("settings-row").click();
    await page.getByTestId("section-about").click();
    await expect.poll(hash).toBe("#/settings/about");
    const mouse = (button: number) =>
      page.evaluate((b) => {
        window.dispatchEvent(new MouseEvent("mouseup", { button: b, bubbles: true }));
      }, button);
    await mouse(3);
    await expect.poll(hash).toBe("#/settings");
    await mouse(4);
    await expect.poll(hash).toBe("#/settings/about");
    await page.keyboard.press(`${mod}+BracketLeft`);
    await expect.poll(hash).toBe("#/settings");
    await page.keyboard.press(`${mod}+BracketRight`);
    await expect.poll(hash).toBe("#/settings/about");
    await page.keyboard.press(`${mod}+Comma`);
    await expect.poll(hash).toBe("#/settings");
  });

  test("settings show real state from main", async () => {
    await page.evaluate(() => {
      window.location.hash = "#/settings/claude";
    });
    await expect(page.getByTestId("claude-path")).toHaveText("/Users/creator/.local/bin/claude");
    await page.getByTestId("section-storage").click();
    const userData = run.env["ALCYO_USER_DATA"] ?? "";
    await expect(page.getByTestId("data-folder")).toHaveText(userData);
    await page.getByTestId("section-encoder").click();
    await expect(page.getByTestId("encoders-card")).toContainText("h264_videotoolbox");
    await page.getByTestId("section-about").click();
    await expect(page.getByTestId("app-version")).toHaveText(/^Version \d+\.\d+\.\d+/);
    await expect(page.getByTestId("about-tools")).toContainText("2026.10.26");
  });

  test("the search box opens, filters, and closes with Esc", async () => {
    await goHome();
    await page.getByTestId("search-button").click();
    const input = page.getByTestId("search-input");
    await expect(input).toBeFocused();
    await input.fill("boss fight");
    await expect(page.getByTestId("no-matches")).toContainText("boss fight");
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId("empty-streams")).toBeVisible();
    await page.keyboard.press(`${mod}+KeyF`);
    await expect(page.getByTestId("search-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search-input")).toHaveCount(0);
  });

  test("New stream focuses the composer; a sent or pasted link shows the import note", async () => {
    await goHome();
    await page.getByTestId("new-stream").click();
    const input = page.getByTestId("composer-input");
    await expect(input).toBeFocused();
    await input.fill("https://www.twitch.tv/videos/123");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toast")).toContainText("Importing links comes in spec 6");
    await expect(input).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toast")).toHaveCount(0);

    await input.focus();
    await input.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://youtu.be/abc");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    await expect(page.getByTestId("toast")).toContainText("Importing links comes in spec 6");
  });

  test("home actions all respond", async () => {
    await goHome();
    await page.getByTestId("choose-file").click();
    await expect(page.getByTestId("toast")).toContainText("Importing files comes in spec 6");
    await page.getByTestId("open-demo").click();
    await expect(page.getByTestId("toast")).toContainText("spec 13");
    await page.getByTestId("paste-link").click();
    await expect(page.getByTestId("composer-input")).toBeFocused();
    await page.getByTestId("attach").click();
    await expect(page.getByTestId("attach-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("attach-menu")).toHaveCount(0);
  });

  test("dragging a file shows the drop target; dropping shows the note and doesn't navigate", async () => {
    await goHome();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "My Stream.mp4", { type: "video/mp4" }));
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true }));
    });
    await expect(page.getByTestId("drop-target")).toBeVisible();
    const navigated = await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "My Stream.mp4", { type: "video/mp4" }));
      const drop = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
      window.dispatchEvent(drop);
      return !drop.defaultPrevented;
    });
    expect(navigated).toBe(false);
    await expect(page.getByTestId("drop-target")).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("My Stream.mp4");
    await expect.poll(hash).toBe("#/");
  });
});

test.describe("with setup incomplete", () => {
  test.beforeAll(async () => {
    run = await launch("fail");
    page = run.page;
  });
  test.afterAll(async () => {
    await run.close();
  });

  test("opens to Setup, explains each failure, and Skip goes home", async () => {
    await expect(page.getByTestId("setup")).toBeVisible();
    await expect.poll(hash).toBe("#/setup");
    await expect(page.getByTestId("check-claude")).toHaveAttribute("data-state", "fail");
    await expect(page.getByTestId("check-claude").getByTestId("fix")).toContainText(
      "Install Claude Code",
    );
    await expect(page.getByTestId("check-yt-dlp").getByTestId("fix")).toContainText(
      "pnpm fetch-binaries",
    );
    await expect(page.getByTestId("check-whisper-model")).toContainText("spec 5");
    await expect(page.getByTestId("continue")).toBeDisabled();
    await expect(page.getByTestId("back")).toHaveText("Skip for now");

    await page.getByTestId("skip-setup").click();
    await expect.poll(hash).toBe("#/");
    await expect(page.getByTestId("setup-row")).toContainText("Finish setup");
  });

  test("the setup row opens Setup, and Back returns", async () => {
    await page.getByTestId("setup-row").click();
    await expect.poll(hash).toBe("#/setup");
    await expect(page.getByTestId("back")).toHaveText("Back");
    await page.getByTestId("back").click();
    await expect.poll(hash).toBe("#/");
  });

  test("Settings shows the setup banner and the missing claude", async () => {
    await page.getByTestId("settings-row").click();
    await expect(page.getByText("Setup isn't finished")).toBeVisible();
    await page.getByTestId("section-claude").click();
    await expect(page.getByTestId("claude-card")).toContainText("Not found");
    await expect(page.getByTestId("claude-card")).toContainText("Install Claude Code");
  });
});
