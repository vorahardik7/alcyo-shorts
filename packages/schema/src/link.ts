// The one link parser. alcyo:// URLs and in-app routes, as in plan section 5.
import { z } from "zod";
import { Id, Ms } from "./primitives";

export const AppLink = z.discriminatedUnion("to", [
  z.object({ to: z.literal("stream"), streamId: Id }),
  z.object({ to: z.literal("message"), streamId: Id, messageId: Id }),
  z.object({
    to: z.literal("short"),
    streamId: Id,
    shortId: Id,
    version: z.number().int().positive().optional(),
    edit: z.boolean().optional(),
  }),
  z.object({ to: z.literal("source"), streamId: Id, t: Ms.optional() }),
  z.object({ to: z.enum(["renders", "settings", "profile"]) }),
]);
export type AppLink = z.infer<typeof AppLink>;

export const LINK_SCHEME = "alcyo";
const PREFIX = `${LINK_SCHEME}://`;
const MAX_LINK_LENGTH = 2048;

/** The message shown for any link this parser rejects. */
export const BAD_LINK_MESSAGE = "That link doesn't point to anything in this app.";

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function positiveInt(text: string): number | null {
  if (!/^[1-9]\d{0,8}$/.test(text)) return null;
  return Number(text);
}

function nonNegativeInt(text: string): number | null {
  if (!/^(0|[1-9]\d{0,11})$/.test(text)) return null;
  return Number(text);
}

// The package stays free of DOM and Node globals, so the query is parsed here.
function queryParam(query: string, name: string): string | null {
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    const key = at === -1 ? pair : pair.slice(0, at);
    if (key === name) return decode(at === -1 ? "" : pair.slice(at + 1)) ?? "";
  }
  return null;
}

function fromSegments(segments: string[], query: string): unknown {
  const [head, ...rest] = segments;
  if (head === "renders" && rest.length === 0) return { to: "renders" };
  if (head === "settings" && rest.length === 0) return { to: "settings" };
  if (head === "settings" && rest.length === 1 && rest[0] === "profile") return { to: "profile" };
  if (head !== "s") return null;

  const [streamId, kind, ...tail] = rest;
  if (streamId === undefined) return null;
  if (kind === undefined) return { to: "stream", streamId };

  if (kind === "m" && tail.length === 1) return { to: "message", streamId, messageId: tail[0] };

  if (kind === "source" && tail.length === 0) {
    const t = queryParam(query, "t");
    if (t === null) return { to: "source", streamId };
    const ms = nonNegativeInt(t);
    return ms === null ? null : { to: "source", streamId, t: ms };
  }

  if (kind === "short") {
    const [shortId, v, n, edit, ...extra] = tail;
    if (shortId === undefined || extra.length > 0) return null;
    if (v === undefined) return { to: "short", streamId, shortId };
    if (v !== "v" || n === undefined) return null;
    const version = positiveInt(n);
    if (version === null) return null;
    if (edit === undefined) return { to: "short", streamId, shortId, version };
    return edit === "edit" ? { to: "short", streamId, shortId, version, edit: true } : null;
  }
  return null;
}

/** Parses an alcyo:// URL. Returns null for anything malformed or unknown. */
export function parseAppLink(url: string): AppLink | null {
  if (typeof url !== "string" || url.length > MAX_LINK_LENGTH) return null;
  if (url.slice(0, PREFIX.length).toLowerCase() !== PREFIX) return null;

  const rest = url.slice(PREFIX.length);
  const queryAt = rest.search(/[?#]/);
  const pathPart = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const queryPart =
    queryAt === -1 || rest[queryAt] === "#" ? "" : rest.slice(queryAt + 1).split("#")[0];

  // Windows sometimes adds a trailing slash; ignore one, but reject empty
  // segments anywhere else.
  const trimmed = pathPart.endsWith("/") ? pathPart.slice(0, -1) : pathPart;
  if (trimmed.length === 0) return null;
  const decoded = trimmed.split("/").map(decode);
  if (decoded.some((s) => s === null)) return null;

  const candidate = fromSegments(decoded as string[], queryPart ?? "");
  const result = AppLink.safeParse(candidate);
  return result.success ? result.data : null;
}

const enc = encodeURIComponent;

/** The path part shared by alcyo:// links and in-app routes, without a leading slash. */
function linkPath(link: AppLink): string {
  switch (link.to) {
    case "renders":
      return "renders";
    case "settings":
      return "settings";
    case "profile":
      return "settings/profile";
    case "stream":
      return `s/${enc(link.streamId)}`;
    case "message":
      return `s/${enc(link.streamId)}/m/${enc(link.messageId)}`;
    case "source":
      return `s/${enc(link.streamId)}/source${link.t === undefined ? "" : `?t=${link.t}`}`;
    case "short": {
      let path = `s/${enc(link.streamId)}/short/${enc(link.shortId)}`;
      if (link.version !== undefined) {
        path += `/v/${link.version}`;
        if (link.edit === true) path += "/edit";
      }
      return path;
    }
  }
}

/** Formats a link as an alcyo:// URL. An edit flag without a version is dropped. */
export function formatAppLink(link: AppLink): string {
  return `${PREFIX}${linkPath(link)}`;
}

/** The in-app route (hash history path) for a link. */
export function appLinkToRoute(link: AppLink): string {
  if (link.to === "message") return `/s/${enc(link.streamId)}#m-${enc(link.messageId)}`;
  return `/${linkPath(link)}`;
}
