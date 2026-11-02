// Folder names that work on macOS and Windows.
import { exists } from "./files.ts";
import { join } from "node:path";

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX = 80;

/** A stream name made safe as a folder name (without the .alcyo suffix). */
export function safeFolderName(name: string): string {
  // eslint-disable-next-line no-control-regex
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim();
  s = s.replace(/[. ]+$/g, "");
  s = s.slice(0, MAX).replace(/[. ]+$/g, "");
  if (s.length === 0) s = "Stream";
  if (RESERVED.test(s)) s = `${s}-`;
  return s;
}

/** <dir>/<name>.alcyo, or "<name> 2.alcyo", "<name> 3.alcyo"… if taken. */
export async function uniqueStreamFolder(dir: string, name: string): Promise<string> {
  const base = safeFolderName(name);
  for (let n = 1; n < 10_000; n++) {
    const candidate = join(dir, `${n === 1 ? base : `${base} ${n}`}.alcyo`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Couldn't find a free folder name.");
}
