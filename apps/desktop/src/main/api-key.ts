// The backup API key. The file holds ciphertext from the OS; this module never
// logs the key and never puts it in settings.json.
import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "@alcyo/store";

export interface SecretCodec {
  encrypt(plain: string): Buffer;
  decrypt(blob: Buffer): string;
}

export class ApiKeyFile {
  constructor(
    readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  /** True only when the saved file still opens. A file copied from another computer doesn't. */
  async has(): Promise<boolean> {
    return (await this.read()) !== null;
  }

  /** The key, or null when there isn't one or it can't be opened. */
  async read(): Promise<string | null> {
    try {
      return this.codec.decrypt(await readFile(this.path));
    } catch {
      return null;
    }
  }

  async write(key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed.length === 0) throw new Error("The key is empty.");
    await writeFileAtomic(this.path, this.codec.encrypt(trimmed));
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
