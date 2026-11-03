import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** prefix + 10 random base-36 characters, e.g. s_k3j9x0q2ma. Safe in paths and links. */
export function newId(prefix: "s" | "src" | "m" | "sh" | "job" | "clip" | "smp" | "r"): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 36];
  return `${prefix}_${out}`;
}
