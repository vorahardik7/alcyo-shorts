// Appends one line per hook run to .hook-log/events.jsonl (gitignored), so the
// hook self-test can see which hooks fired and what Kiro sent on stdin.
// Only key names and the chosen path or command are logged, not file contents.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} root
 * @param {Record<string, unknown>} entry
 */
export function logHookEvent(root, entry) {
  try {
    const dir = join(root, ".hook-log");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "events.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  } catch {
    // Logging must never break a hook.
  }
}

/** Reads all of stdin as text; resolves "" if there's none. */
export async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parsePayload(text) {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
