// thread/messages.jsonl: append-only, one full line per write. Reading keeps
// the highest rev per id, in the order each id first appeared, and drops a
// torn last line from a crash mid-write.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Message } from "@alcyo/schema";

export async function appendMessage(path: string, message: Message): Promise<void> {
  const line = `${JSON.stringify(Message.parse(message))}\n`;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line, "utf8");
}

export interface ReadResult {
  messages: Message[];
  /** Line numbers of bad lines in the middle of the file (not the torn last one). */
  skipped: number[];
}

export function parseMessages(text: string): ReadResult {
  const lines = text.split("\n");
  const torn = !text.endsWith("\n");
  const order: string[] = [];
  const latest = new Map<string, Message>();
  const skipped: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim().length === 0) return;
    let parsed: Message | null;
    try {
      const result = Message.safeParse(JSON.parse(line));
      parsed = result.success ? result.data : null;
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      if (!(torn && i === lines.length - 1)) skipped.push(i + 1);
      return;
    }
    const prev = latest.get(parsed.id);
    if (prev === undefined) order.push(parsed.id);
    if (prev === undefined || parsed.rev >= prev.rev) latest.set(parsed.id, parsed);
  });
  return { messages: order.map((id) => latest.get(id)!), skipped };
}

export async function readMessages(path: string): Promise<ReadResult> {
  try {
    return parseMessages(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { messages: [], skipped: [] };
    throw error;
  }
}

/** The last `limit` messages before the message `before` (or the end). */
export function pageMessages(all: readonly Message[], limit: number, before?: string): Message[] {
  let end = all.length;
  if (before !== undefined) {
    const at = all.findIndex((m) => m.id === before);
    if (at !== -1) end = at;
  }
  return all.slice(Math.max(0, end - limit), end);
}
