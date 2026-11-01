// Main <-> utilityProcess worker contract, carried on a MessagePort.
// Both sides parse every message they receive with these schemas.
import { z } from "zod";

const RequestId = z.string().min(1).max(64);

/** Sent once on the process parentPort, carrying the MessagePort. */
export const WorkerInit = z.object({ type: z.literal("init") });

export const MainToWorker = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), id: RequestId, text: z.string().max(1000) }),
]);
export type MainToWorker = z.infer<typeof MainToWorker>;

export const WorkerToMain = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("pong"), id: RequestId, text: z.string().max(1000) }),
  z.object({ type: z.literal("error"), id: RequestId.optional(), message: z.string().max(500) }),
]);
export type WorkerToMain = z.infer<typeof WorkerToMain>;
