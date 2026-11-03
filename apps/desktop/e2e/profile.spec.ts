// Onboarding, Settings > Profile, past shorts and templates, end to end. The
// agent is the scripted test agent (ALCYO_TEST_AGENT=script); the worker,
// ffmpeg and the files are real.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  type Launched,
  launch,
  stubFileDialog,
  stubFileDialogMany,
  stubSaveDialog,
} from "./launch";

const win = process.platform === "win32";
const target = `${win ? "win" : "mac"}-${process.arch}`;
const bin =
  process.env["ALCYO_BIN_DIR"] ?? join(import.meta.dirname, "..", "resources", "bin", target);
const ffmpeg = join(bin, win ? "ffmpeg.exe" : "ffmpeg");

/** A posted short: two scenes, so one cut. */
function makeShort(dir: string, name: string): string {
  const out = join(dir, name);
  execFileSync(ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=360x640:r=30:d=4",
    "-f", "lavfi", "-i", "color=c=blue:s=360x640:r=30:d=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]",
    "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    out,
  ]); // prettier-ignore
  return out;
}

const ASS = `[Script Info]
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: My Captions,Comic Sans MS,90,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,6,0,2,40,40,500,1
`;

test.describe("creator profile", () => {
  let run: Launched;
  let page: Page;
  const hash = () => page.evaluate(() => window.location.hash);

  test.beforeAll(async () => {
    run = await launch("pass", { ALCYO_TEST_AGENT: "script" });
    page = run.page;
    await page.getByTestId("sidebar").waitFor();
  });
  test.afterAll(async () => run.close());

  test("the interview asks, takes answers, chips and skips, then saves the chosen look", async () => {
    await page.getByTestId("home-profile").click();
    await expect.poll(hash).toBe("#/onboarding");
    await page.getByTestId("interview-start").click();
    await expect(page.getByTestId("interview-question")).toHaveText(
      "What do you stream, and who watches?",
    );
    await page.getByTestId("interview-input").fill("Minecraft hardcore with chat");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("interview-question")).toHaveText(
      "What makes a moment worth a short for you?",
    );
    await page.getByTestId("interview-chip").filter({ hasText: "Close calls" }).click();
    await expect(page.getByTestId("interview-question")).toHaveText(
      "How long are your shorts usually?",
    );
    await page.getByTestId("interview-skip").click();
    await expect(page.getByTestId("interview-look")).toBeVisible();
    await expect(page.getByTestId("interview-answer")).toHaveText([
      "Minecraft hardcore with chat",
      "Close calls",
      "Skipped",
    ]);
    await page.getByTestId("look-punch").click();
    await expect(page.getByTestId("interview-done")).toBeVisible();

    const saved = JSON.parse(
      readFileSync(join(run.env["ALCYO_USER_DATA"]!, "profile.json"), "utf8"),
    ) as { streams: string; captionPresetId: string; hookPresetId: string };
    expect(saved).toMatchObject({
      streams: "Minecraft hardcore with chat",
      captionPresetId: "punch",
      hookPresetId: "hook-plain",
    });
    await page.getByTestId("done-open-profile").click();
    await expect.poll(hash).toBe("#/settings/profile");
    await expect(page.getByTestId("profile-streams")).toHaveValue("Minecraft hardcore with chat");
    await expect(page.getByTestId("profile-look-punch")).toHaveAttribute("aria-pressed", "true");
  });

  test("Settings edits are checked and saved", async () => {
    await page.getByTestId("profile-min").fill("50");
    await expect(page.getByTestId("profile-save")).toBeDisabled();
    await page.getByTestId("profile-min").fill("20");
    await page.getByTestId("profile-name").fill("Soul");
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("toast")).toContainText("Profile saved");
    const saved = JSON.parse(
      readFileSync(join(run.env["ALCYO_USER_DATA"]!, "profile.json"), "utf8"),
    ) as { name: string; lengthMs: { min: number } };
    expect(saved).toMatchObject({ name: "Soul", lengthMs: { min: 20_000 } });
  });

  test("past shorts are measured in place, and the style is written from them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alcyo-e2e-shorts 名前 "));
    const shorts = [makeShort(dir, "posted one.mp4"), makeShort(dir, "posted two.mp4")];
    await stubFileDialogMany(run.app, shorts);
    await page.getByTestId("samples-add").click();
    await expect(page.getByTestId("sample-row")).toHaveCount(2, { timeout: 60_000 });
    await expect(page.getByTestId("sample-row").first()).toContainText("a cut every 4.0 s");
    expect(readdirSync(dir).sort()).toEqual(["posted one.mp4", "posted two.mp4"]);
    const samples = join(run.env["ALCYO_USER_DATA"]!, "samples");
    for (const id of readdirSync(samples)) {
      expect(readdirSync(join(samples, id)).sort()).toEqual(["analysis", "sample.json"]);
    }

    await page.getByTestId("style-write").click();
    await expect(page.getByTestId("style-summary")).toHaveValue(
      "Opens on the reaction. Fast cuts, few pauses.",
    );
    await expect(page.getByTestId("style-numbers")).toContainText(
      "a cut every 4.0 s · from 2 shorts",
    );
  });

  test("an .ass file imports as a look with a font note, and the looks export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alcyo-e2e-tpl-"));
    writeFileSync(join(dir, "editor look.ass"), ASS);
    await stubFileDialog(run.app, join(dir, "editor look.ass"));
    await page.getByTestId("template-import").click();
    await expect(page.getByTestId("toast")).toContainText("Added 1 look");
    await expect(page.getByTestId("toast")).toContainText("Comic Sans MS isn't bundled");
    await expect(page.getByTestId("templates-card")).toContainText("My Captions");

    const out = join(dir, "export.alcyo-template.json");
    await stubSaveDialog(run.app, out);
    await page.getByTestId("template-export").click();
    await expect(page.getByTestId("toast")).toContainText("Template exported");
    const template = JSON.parse(readFileSync(out, "utf8")) as {
      kind: string;
      name: string;
      captionPresets: Array<{ id: string }>;
      targetLengthMs: { min: number };
    };
    expect(template).toMatchObject({ kind: "alcyo-template", name: "Soul's look" });
    expect(template.captionPresets.map((p) => p.id)).toEqual([
      "punch",
      "ass-editor-look-my-captions",
    ]);
    expect(template.targetLengthMs.min).toBe(20_000);
  });
});
