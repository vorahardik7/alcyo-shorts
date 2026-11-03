// alcyo-media:// (electron.md): video, thumbnails and fonts for the window.
// URLs name things by id, never by path, so the page can only reach the open
// projects' sources and cache and the bundled fonts:
//
//   alcyo-media://source/<streamId>/<sourceId>   the recording, or its proxy
//   alcyo-media://thumb/<streamId>               the sidebar thumbnail
//   alcyo-media://fonts/<file>.ttf               a bundled caption font
//
// Range requests get 206 so video can seek. Electron-free except for the
// Response the handler returns, so it's tested with real files.
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { exists, type ProjectStore } from "@alcyo/store";

export const MEDIA_SCHEME = "alcyo-media";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
};

const ID = /^[a-z]+_[0-9a-z]{6,40}$/;
const FONT = /^[A-Za-z0-9-]+\.(ttf|otf|woff2)$/;

export interface MediaDeps {
  forStream: (streamId: string) => Promise<ProjectStore>;
  /** The index's thumbnail for a stream, or null. */
  thumbnail: (streamId: string) => Promise<string | null>;
  fontsDir: string;
}

const CORS = { "Access-Control-Allow-Origin": "*" };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: CORS });
}

/** "bytes=0-99" -> [0, 99] within size, or null for no or a bad range. */
export function parseRange(header: string | null, size: number): [number, number] | null | "bad" {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return "bad";
  const [, a, b] = m;
  if (a === "" && b === "") return "bad";
  let start: number;
  let end: number;
  if (a === "") {
    const n = Number(b);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start > end || start >= size) return "bad";
  return [start, end];
}

/** A file as a Response, honoring one Range. */
export async function fileResponse(path: string, range: string | null): Promise<Response> {
  let size: number;
  try {
    const st = await stat(path);
    if (!st.isFile()) return notFound();
    size = st.size;
  } catch {
    return notFound();
  }
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  const base = { ...CORS, "Content-Type": type, "Accept-Ranges": "bytes" };
  const r = parseRange(range, size);
  if (r === "bad") {
    return new Response(null, {
      status: 416,
      headers: { ...base, "Content-Range": `bytes */${size}` },
    });
  }
  const [start, end] = r ?? [0, size - 1];
  const body =
    size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream);
  return new Response(body, {
    status: r === null ? 200 : 206,
    headers: {
      ...base,
      "Content-Length": String(size === 0 ? 0 : end - start + 1),
      ...(r === null ? {} : { "Content-Range": `bytes ${start}-${end}/${size}` }),
    },
  });
}

/** True when child is inside dir. */
function inside(dir: string, child: string): boolean {
  const rel = relative(dir, child);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/** The playable file for a source: the recording when Chromium plays it, else the proxy. */
export async function playableFile(store: ProjectStore, sourceId: string): Promise<string | null> {
  const project = await store.project();
  if (!project.sources.some((s) => s.sourceId === sourceId)) return null;
  const source = await store.source(sourceId);
  if (source.probe?.playsDirectly === true && (await exists(source.origin.path))) {
    return source.origin.path;
  }
  const proxy = join(store.paths.cacheDir(sourceId), "proxy.mp4");
  return (await exists(proxy)) ? proxy : null;
}

/** Resolves an alcyo-media:// URL to a file, or null. */
export async function resolveMedia(url: string, deps: MediaDeps): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${MEDIA_SCHEME}:`) return null;
  const parts = u.pathname
    .split("/")
    .filter((p) => p.length > 0)
    .map(decodeURIComponent);
  switch (u.hostname) {
    case "fonts": {
      const [file, ...rest] = parts;
      if (file === undefined || rest.length > 0 || !FONT.test(file)) return null;
      const names = await readdir(deps.fontsDir).catch(() => [] as string[]);
      return names.includes(file) ? join(deps.fontsDir, file) : null;
    }
    case "source": {
      const [streamId, sourceId, ...rest] = parts;
      if (streamId === undefined || sourceId === undefined || rest.length > 0) return null;
      if (!ID.test(streamId) || !ID.test(sourceId)) return null;
      try {
        return await playableFile(await deps.forStream(streamId), sourceId);
      } catch {
        return null;
      }
    }
    case "thumb": {
      const [streamId, ...rest] = parts;
      if (streamId === undefined || rest.length > 0 || !ID.test(streamId)) return null;
      try {
        const store = await deps.forStream(streamId);
        const thumb = await deps.thumbnail(streamId);
        return thumb !== null && inside(store.paths.cache, thumb) ? thumb : null;
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

/** The protocol.handle callback. */
export function mediaHandler(deps: MediaDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return notFound();
    const path = await resolveMedia(request.url, deps);
    if (path === null) return notFound();
    return fileResponse(path, request.headers.get("range"));
  };
}

/** alcyo-media://source/<streamId>/<sourceId> */
export function sourceUrl(streamId: string, sourceId: string): string {
  return `${MEDIA_SCHEME}://source/${streamId}/${sourceId}`;
}
