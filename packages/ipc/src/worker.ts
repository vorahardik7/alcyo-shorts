// Main <-> utilityProcess worker contract, carried on a MessagePort.
// Both sides parse every message they receive with these schemas.
import { z } from "zod";
import { AnalysisEvent, AnalysisRequest, AnalysisResult, JobId } from "./analysis";
import {
  ClipMatchRequest,
  ClipMatchResult,
  DownloadRequest,
  DownloadResult,
  ImportEvent,
  LinkInfoRequest,
  LinkInfoResult,
} from "./import";
import { RenderEvent, RenderRequest, RenderResult } from "./render";
import { SetupReport, SetupRequest } from "./setup";

const RequestId = z.string().min(1).max(64);

/** Sent once on the process parentPort, carrying the MessagePort. */
export const WorkerInit = z.object({ type: z.literal("init") });

export const MainToWorker = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), id: RequestId, text: z.string().max(1000) }),
  z.object({ type: z.literal("setup-check"), id: RequestId, request: SetupRequest }),
  z.object({
    type: z.literal("analysis-run"),
    id: RequestId,
    jobId: JobId,
    request: AnalysisRequest,
  }),
  z.object({ type: z.literal("link-info"), id: RequestId, request: LinkInfoRequest }),
  z.object({
    type: z.literal("download-run"),
    id: RequestId,
    jobId: JobId,
    request: DownloadRequest,
  }),
  z.object({
    type: z.literal("clip-match-run"),
    id: RequestId,
    jobId: JobId,
    request: ClipMatchRequest,
  }),
  z.object({
    type: z.literal("render-run"),
    id: RequestId,
    jobId: JobId,
    request: RenderRequest,
  }),
  /** Cancels a running job. Its request then fails with code "cancelled". */
  z.object({ type: z.literal("job-cancel"), jobId: JobId }),
]);

export const JobEvent = z.union([AnalysisEvent, ImportEvent, RenderEvent]);
export type JobEvent = z.infer<typeof JobEvent>;
export type MainToWorker = z.infer<typeof MainToWorker>;

export const WorkerToMain = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("pong"), id: RequestId, text: z.string().max(1000) }),
  z.object({ type: z.literal("setup-report"), id: RequestId, report: SetupReport }),
  z.object({
    type: z.literal("job-event"),
    jobId: JobId,
    event: JobEvent,
  }),
  z.object({ type: z.literal("analysis-result"), id: RequestId, result: AnalysisResult }),
  z.object({ type: z.literal("link-info-result"), id: RequestId, result: LinkInfoResult }),
  z.object({ type: z.literal("download-result"), id: RequestId, result: DownloadResult }),
  z.object({ type: z.literal("clip-match-result"), id: RequestId, result: ClipMatchResult }),
  z.object({ type: z.literal("render-result"), id: RequestId, result: RenderResult }),
  z.object({
    type: z.literal("error"),
    id: RequestId.optional(),
    message: z.string().max(500),
    /** Set for engine failures: "cancelled", "unreadable", "tool-failed". */
    code: z.string().max(40).optional(),
  }),
]);
export type WorkerToMain = z.infer<typeof WorkerToMain>;
