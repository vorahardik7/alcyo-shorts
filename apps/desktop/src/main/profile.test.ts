import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalysisRequest, AnalysisResult } from "@alcyo/ipc";
import type { LlmProvider } from "@alcyo/planner";
import { Template } from "@alcyo/schema";
import * as F from "@alcyo/schema/testing";
import { ProfileStore } from "@alcyo/store";
import { beforeEach, describe, expect, it } from "vitest";
import { ProfileService } from "./profile";
import { scriptedAgent } from "./test-agent";

let root: string;
let store: ProfileStore;
let agent: LlmProvider;
let chosen: string[];
let template: string | null;
let exportTo: string | null;
let analyzed: AnalysisRequest[];
let service: ProfileService;
let queue: Promise<unknown>;

function result(req: AnalysisRequest): AnalysisResult {
  return {
    sourceId: req.sourceId,
    probe: {
      durationMs: 30_000,
      container: "mov,mp4",
      video: null,
      audio: null,
      playsDirectly: true,
    },
    fingerprint: {
      sizeBytes: 1,
      headSha256: "a".repeat(64),
      tailSha256: "b".repeat(64),
      durationMs: 30_000,
      layout: "",
    },
    steps: {},
    problems: [],
    poster: null,
    encoder: null,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "alcyo-profile-"));
  store = new ProfileStore(join(root, "userData"));
  agent = scriptedAgent();
  chosen = [];
  template = null;
  exportTo = null;
  analyzed = [];
  queue = Promise.resolve();
  service = new ProfileService({
    store,
    interviewPath: join(root, "userData", "interview.json"),
    agent: {
      provider: () => Promise.resolve(agent),
      model: () => Promise.resolve("sonnet"),
      label: () => Promise.resolve("Grok"),
    },
    worker: () => ({
      analyze: (req) => {
        analyzed.push(req);
        const done = (async () => {
          if (req.sourcePath.includes("broken")) throw new Error("This file couldn't be read.");
          await mkdir(req.analysisDir, { recursive: true });
          await mkdir(req.cacheDir, { recursive: true });
          await writeFile(join(req.cacheDir, "audio.wav"), "wav");
          await writeFile(
            join(req.analysisDir, "transcript.json"),
            JSON.stringify({ ...F.transcript, sourceId: req.sourceId }),
          );
          await writeFile(
            join(req.analysisDir, "scenes.json"),
            JSON.stringify({ schemaVersion: 1, sourceId: req.sourceId, cutsMs: [10_000, 20_000] }),
          );
          return result(req);
        })();
        return { done, cancel: () => undefined };
      },
    }),
    analysisBase: () =>
      Promise.resolve({
        tools: { ffmpeg: "f", ffprobe: "p", whisper: "w" },
        toolVersions: { ffmpeg: "1", whisper: "1" },
        model: null,
        vadModel: "v",
        mode: "full",
        encoder: null,
        threads: 1,
      }),
    runExclusive: (fn) => {
      const run = queue.then(fn, fn);
      queue = run.catch(() => undefined);
      return run;
    },
    chooseShorts: () => Promise.resolve(chosen),
    chooseTemplate: () => Promise.resolve(template),
    chooseExport: () => Promise.resolve(exportTo),
    emit: () => undefined,
    log: () => undefined,
  });
});

describe("interview", () => {
  it("asks, takes answers and skips, then saves the profile with the chosen look", async () => {
    let state = await service.start();
    expect(state).toMatchObject({
      phase: "asking",
      question: { text: "What do you stream, and who watches?" },
    });
    state = await service.answer("Minecraft hardcore");
    expect(state.question?.chips).toContain("Close calls");
    await service.answer(null);
    state = await service.answer("30 to 45 s");
    expect(state.phase).toBe("look");
    expect(state.turns.map((t) => t.answer)).toEqual(["Minecraft hardcore", null, "30 to 45 s"]);
    expect(state.draft?.streams).toBe("Minecraft hardcore");

    const view = await service.finish("punch");
    expect(view.profile).toMatchObject({
      streams: "Minecraft hardcore",
      lengthMs: { min: 30_000, max: 45_000 },
      captionPresetId: "punch",
      hookPresetId: "hook-plain",
    });
    expect(view.agent).toBe("Grok");
    expect((await service.interview()).phase).toBe("done");
  });

  it("finishes early on request, and keeps the question when the agent fails", async () => {
    await service.start();
    const failing = agent;
    agent = { name: "fake", complete: () => Promise.reject(new Error("Grok didn't answer.")) };
    const failed = await service.answer("Minecraft");
    expect(failed).toMatchObject({ phase: "asking", error: "The agent didn't answer." });
    expect(failed.turns).toEqual([]);
    agent = failing;
    const done = await service.answer("Minecraft", true);
    expect(done.phase).toBe("look");
    expect(done.turns).toHaveLength(1);
  });

  it("saves every default when the whole interview is skipped", async () => {
    const view = await service.finish("clean");
    expect(view.profile).toMatchObject({ captionPresetId: "clean", streams: "Live streams" });
  });
});

describe("past shorts", () => {
  it("analyzes each one in place, keeps only measurements, and writes the style", async () => {
    const shorts = join(root, "My shorts 名前");
    await mkdir(shorts);
    chosen = [join(shorts, "one.mp4"), join(shorts, "two.mp4"), join(shorts, "broken.mp4")];
    for (const path of chosen) await writeFile(path, "video");
    expect(await service.addSamples()).toEqual({ added: 3, skipped: 0 });
    await queue;
    expect(analyzed.map((r) => r.mode)).toEqual(["quick", "quick", "quick"]);
    expect(analyzed[0]!.sourcePath).toBe(chosen[0]);

    const view = await service.view();
    expect(view.samples.map((s) => s.fileName)).toEqual(["one.mp4", "two.mp4"]);
    expect(view.samples[0]!.measures).toMatchObject({ lengthMs: 30_000, cutEveryMs: 10_000 });
    expect(view.pending).toEqual([
      expect.objectContaining({ fileName: "broken.mp4", state: "failed" }),
    ]);
    // The videos stay where they are; the sample folder has no copy and no cache.
    expect((await readdir(shorts)).sort()).toEqual(["broken.mp4", "one.mp4", "two.mp4"]);
    const dir = store.sampleDir(view.samples[0]!.sampleId);
    expect((await readdir(dir)).sort()).toEqual(["analysis", "sample.json"]);
    expect(await readFile(join(dir, "sample.json"), "utf8")).not.toContain(shorts);

    const styled = await service.writeStyle();
    expect(styled.profile?.style).toMatchObject({
      summary: "Opens on the reaction. Fast cuts, few pauses.",
      cutEveryMs: 10_000,
      sampleCount: 2,
    });
    const after = await service.removeSample(view.samples[0]!.sampleId);
    expect(after.samples).toHaveLength(1);
  });

  it("stops at 50", async () => {
    chosen = Array.from({ length: 52 }, (_, i) => join(root, `s${i}.mp4`));
    expect(await service.addSamples()).toEqual({ added: 50, skipped: 2 });
  });
});

describe("templates", () => {
  it("imports an .ass file and a template, and exports the looks in use", async () => {
    template = join(root, "look.ass");
    await writeFile(
      template,
      "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Main,Papyrus,20,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,40,1\n",
    );
    expect(await service.importTemplate()).toEqual({
      added: 1,
      notes: ["Papyrus isn't bundled, so Inter is used instead."],
    });
    template = join(root, "soul.alcyo-template.json");
    await writeFile(template, JSON.stringify(F.template));
    expect(await service.importTemplate()).toMatchObject({ added: 2 });
    const view = await service.view();
    expect(view.captionPresets.map((p) => p.origin)).toEqual([
      "builtin",
      "builtin",
      "builtin",
      "builtin",
      "ass",
      "template",
    ]);
    template = join(root, "bad.json");
    await writeFile(template, "{}");
    await expect(service.importTemplate()).rejects.toThrow("couldn't be read");

    await service.finish("punch");
    exportTo = join(root, "out", "mine.alcyo-template.json");
    await mkdir(join(root, "out"));
    expect(await service.exportTemplate()).toEqual({ path: exportTo });
    const out = Template.parse(JSON.parse(await readFile(exportTo, "utf8")));
    expect(out.captionPresets.map((p) => p.id)).toEqual([
      "punch",
      "ass-look-main",
      "t-soul-s-look-bold-pop",
    ]);
  });
});
