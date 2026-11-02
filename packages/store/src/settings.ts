// userData/settings.json, read with defaults and patched atomically.
import { join } from "node:path";
import { Settings, defaultSettings } from "@alcyo/schema";
import { exists, readProjectFile, writeJsonAtomic } from "./files.ts";

export class SettingsFile {
  readonly path: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    userData: string,
    private readonly platform: "darwin" | "win32" | "linux",
  ) {
    this.path = join(userData, "settings.json");
  }

  async read(): Promise<Settings> {
    await this.queue;
    if (!(await exists(this.path))) return defaultSettings(this.platform);
    return readProjectFile<Settings>(this.path, "settings", "settings.json");
  }

  patch(patch: Partial<Omit<Settings, "schemaVersion">>): Promise<Settings> {
    const run = this.queue.then(async () => {
      const current = (await exists(this.path))
        ? await readProjectFile<Settings>(this.path, "settings", "settings.json")
        : defaultSettings(this.platform);
      const next = Settings.parse({ ...current, ...patch });
      await writeJsonAtomic(this.path, next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
