// A provider for tests. It never runs a command.
import type { LlmProvider } from "./provider";

export function fakeProvider(value: unknown): LlmProvider {
  return { name: "fake", complete: () => Promise.resolve(value) };
}
