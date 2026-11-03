// userData's profile files (plan section 15): profile.json, presets.json,
// templates/ and samples/. Past shorts are never copied; a sample folder
// holds only its analysis files and sample.json.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILTIN_CAPTION_PRESETS,
  BUILTIN_HOOK_PRESETS,
  type CaptionPreset,
  type CreatorProfile,
  CreatorProfile as CreatorProfileSchema,
  type HookPreset,
  type PresetFile,
  PresetFile as PresetFileSchema,
  type SampleFile,
  SampleFile as SampleFileSchema,
  type Template,
  checkProfile,
} from "@alcyo/schema";
import { StoreError, exists, readJson, readProjectFile, writeJsonAtomic } from "./files.ts";

export interface AllPresets {
  captionPresets: CaptionPreset[];
  hookPresets: HookPreset[];
}

export class ProfileStore {
  readonly profilePath: string;
  readonly presetsPath: string;
  readonly templatesDir: string;
  readonly samplesDir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly userData: string) {
    this.profilePath = join(userData, "profile.json");
    this.presetsPath = join(userData, "preset.json");
    this.templatesDir = join(userData, "templates");
    this.samplesDir = join(userData, "samples");
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async profile(): Promise<CreatorProfile | null> {
    if (!(await exists(this.profilePath))) return null;
    return readProjectFile<CreatorProfile>(this.profilePath, "profile", "profile.json");
  }

  /** Saves after the schema and range checks, and only with preset ids that exist. */
  saveProfile(profile: CreatorProfile): Promise<CreatorProfile> {
    return this.serial(async () => {
      const next = CreatorProfileSchema.parse(profile);
      const issues = checkProfile(next);
      if (issues.length > 0) throw new StoreError("bad-file", issues[0]!.message);
      const all = await this.presets();
      if (!all.captionPresets.some((p) => p.id === next.captionPresetId))
        next.captionPresetId = BUILTIN_CAPTION_PRESETS[0]!.id;
      if (!all.hookPresets.some((p) => p.id === next.hookPresetId))
        next.hookPresetId = BUILTIN_HOOK_PRESETS[0]!.id;
      await writeJsonAtomic(this.profilePath, next);
      return next;
    });
  }

  private async storedPresets(): Promise<PresetFile> {
    if (!(await exists(this.presetsPath))) {
      return { schemaVersion: 1, captionPresets: [], hookPresets: [] };
    }
    return readProjectFile<PresetFile>(this.presetsPath, "preset", "preset.json");
  }

  /** Built-in presets first, then imported ones. */
  async presets(): Promise<AllPresets> {
    const stored = await this.storedPresets();
    return {
      captionPresets: [...BUILTIN_CAPTION_PRESETS, ...stored.captionPresets],
      hookPresets: [...BUILTIN_HOOK_PRESETS, ...stored.hookPresets],
    };
  }

  /** Adds imported presets. One with the same id replaces the old one. */
  addPresets(add: AllPresets): Promise<AllPresets> {
    return this.serial(async () => {
      const stored = await this.storedPresets();
      const builtin = new Set(
        [...BUILTIN_CAPTION_PRESETS, ...BUILTIN_HOOK_PRESETS].map((p) => p.id),
      );
      const merge = <T extends { id: string }>(old: T[], extra: T[]) => [
        ...old.filter((p) => !extra.some((e) => e.id === p.id)),
        ...extra.filter((p) => !builtin.has(p.id)),
      ];
      const next = PresetFileSchema.parse({
        schemaVersion: 1,
        captionPresets: merge(stored.captionPresets, add.captionPresets),
        hookPresets: merge(stored.hookPresets, add.hookPresets),
      });
      await writeJsonAtomic(this.presetsPath, next);
      return this.presets();
    });
  }

  /** Keeps a copy of an imported template, as checked JSON. */
  async saveTemplate(name: string, template: Template): Promise<string> {
    const file = join(this.templatesDir, `${name}.alcyo-template.json`);
    await writeJsonAtomic(file, template);
    return file;
  }

  // Samples

  sampleDir(sampleId: string): string {
    return join(this.samplesDir, sampleId);
  }

  async samples(): Promise<SampleFile[]> {
    const names = await readdir(this.samplesDir).catch(() => [] as string[]);
    const out: SampleFile[] = [];
    for (const name of names) {
      const file = await readJson(
        join(this.samplesDir, name, "sample.json"),
        SampleFileSchema,
      ).catch(() => null);
      if (file !== null) out.push(file);
    }
    return out.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  async saveSample(sample: SampleFile): Promise<void> {
    await writeJsonAtomic(
      join(this.sampleDir(sample.sampleId), "sample.json"),
      SampleFileSchema.parse(sample),
    );
  }

  async removeSample(sampleId: string): Promise<void> {
    if (!/^smp_[0-9a-z]+$/.test(sampleId))
      throw new StoreError("not-found", "That past short isn't here.");
    await rm(this.sampleDir(sampleId), { recursive: true, force: true, maxRetries: 5 });
  }

  /** The analysis cache of a measured sample isn't needed again. */
  async dropSampleCache(sampleId: string): Promise<void> {
    await rm(join(this.sampleDir(sampleId), "cache"), {
      recursive: true,
      force: true,
      maxRetries: 5,
    });
  }
}
