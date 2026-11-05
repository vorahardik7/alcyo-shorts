// Every path inside a stream folder (plan section 15), from one place.
import { join } from "node:path";

const pad = (n: number) => String(n).padStart(4, "0");

export function layout(folder: string) {
  return {
    folder,
    project: join(folder, "project.json"),
    thread: join(folder, "thread"),
    messages: join(folder, "thread", "messages.jsonl"),
    sourceDir: (id: string) => join(folder, "sources", id),
    source: (id: string) => join(folder, "sources", id, "source.json"),
    analysisDir: (id: string) => join(folder, "sources", id, "analysis"),
    analysis: (id: string, file: string) => join(folder, "sources", id, "analysis", file),
    cacheDir: (id: string) => join(folder, "cache", id),
    shortDir: (id: string) => join(folder, "shorts", id),
    short: (id: string) => join(folder, "shorts", id, "short.json"),
    draft: (id: string, base?: number) =>
      join(folder, "shorts", id, base === undefined ? "draft.json" : `draft-v${pad(base)}.json`),
    styles: (id: string, n: number) =>
      join(folder, "shorts", id, "versions", `${pad(n)}.styles.json`),
    versions: (id: string) => join(folder, "shorts", id, "versions"),
    version: (id: string, n: number, by: "claude" | "user") =>
      join(folder, "shorts", id, "versions", `${pad(n)}.${by}.json`),
    clips: join(folder, "clips"),
    clipDir: (id: string) => join(folder, "clips", id),
    clip: (id: string) => join(folder, "clips", id, "clip.json"),
    clipAnalysisDir: (id: string) => join(folder, "clips", id, "analysis"),
    renders: join(folder, "renders"),
    renderIndex: join(folder, "renders", "index.json"),
    cache: join(folder, "cache"),
    logs: join(folder, "logs"),
  };
}
export type Layout = ReturnType<typeof layout>;
