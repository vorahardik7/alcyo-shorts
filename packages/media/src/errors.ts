// Engine failures with a plain message for the thread, and a code for logic.
export type MediaErrorCode = "unreadable" | "no-audio" | "tool-failed" | "cancelled";

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  /** The tool's last stderr lines, for the job log. Never shown in the thread. */
  readonly log: string[];

  constructor(code: MediaErrorCode, message: string, log: string[] = []) {
    super(message);
    this.name = "MediaError";
    this.code = code;
    this.log = log;
  }
}

export const UNREADABLE_MESSAGE = "This file couldn't be read. It may be damaged or not a video.";
export const NO_AUDIO_MESSAGE = "This file has no audio, so it can't be transcribed.";

export function stepFailed(step: string, log: string[]): MediaError {
  return new MediaError(
    "tool-failed",
    `The ${step} step stopped. The job log has the details.`,
    log,
  );
}
export const NO_MODEL_MESSAGE =
  "The transcription model isn't downloaded yet. Open Setup to get it.";
