// userData/streams.json: stream id -> folder, name, thumbnail, last activity,
// unread, preview. Writes are serialized so two updates can't lose each other.
import { StreamsIndex as StreamsIndexSchema } from "@alcyo/schema";
import { join } from "node:path";
import { StoreError, exists, readProjectFile, writeJsonAtomic } from "./files.ts";

export type StreamEntry = StreamsIndexSchema["streams"][number];

export class StreamsIndex {
  readonly path: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(userData: string) {
    this.path = join(userData, "streams.json");
  }

  private async read(): Promise<StreamEntry[]> {
    if (!(await exists(this.path))) return [];
    const file = await readProjectFile<StreamsIndexSchema>(this.path, "streams", "streams.json");
    return file.streams;
  }

  private change<T>(fn: (streams: StreamEntry[]) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const streams = await this.read();
      const result = fn(streams);
      await writeJsonAtomic(this.path, StreamsIndexSchema.parse({ schemaVersion: 1, streams }));
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Newest activity first. */
  async list(): Promise<StreamEntry[]> {
    await this.queue;
    const streams = await this.read();
    return streams.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  }

  async get(streamId: string): Promise<StreamEntry> {
    const found = (await this.list()).find((s) => s.streamId === streamId);
    if (found === undefined) throw new StoreError("not-found", "That stream isn't in this app.");
    return found;
  }

  upsert(entry: StreamEntry): Promise<void> {
    return this.change((streams) => {
      const at = streams.findIndex((s) => s.streamId === entry.streamId);
      if (at === -1) streams.push(entry);
      else streams[at] = entry;
    });
  }

  update(streamId: string, patch: Partial<Omit<StreamEntry, "streamId">>): Promise<StreamEntry> {
    return this.change((streams) => {
      const at = streams.findIndex((s) => s.streamId === streamId);
      if (at === -1) throw new StoreError("not-found", "That stream isn't in this app.");
      const next = { ...streams[at]!, ...patch };
      streams[at] = next;
      return next;
    });
  }
}
