// The utilityProcess worker. Main sends one { type: "init" } message on the
// parentPort carrying a MessagePort; every job message after that goes over the
// port and is checked against @alcyo/ipc's worker contract.
import { WorkerInit } from "@alcyo/ipc";
import { downloadMedia, fetchLinkInfo, matchClipFiles } from "@alcyo/import";
import { analyze, runTool } from "@alcyo/media";
import type { MessagePortMain } from "electron";
import { electronPort, serveWorker } from "../shared/port";
import { realSetupDeps } from "./exec";
import { runSetupCheck } from "./setup";

process.parentPort.once("message", (event: { data: unknown; ports: MessagePortMain[] }) => {
  const port = event.ports[0];
  if (!WorkerInit.safeParse(event.data).success || port === undefined) {
    console.error("[worker] Expected an init message with a port. Exiting.");
    process.exit(1);
  }
  const deps = realSetupDeps();
  serveWorker(electronPort(port), undefined, {
    setupCheck: (request) => runSetupCheck(request, deps),
    analyze: (request, onEvent, signal) => analyze(request, { run: runTool }, onEvent, signal),
    linkInfo: (request) =>
      fetchLinkInfo({
        run: runTool,
        ytDlp: request.ytDlp,
        ffmpegDir: request.ffmpegDir,
        url: request.url,
      }),
    download: (request, onEvent, signal) =>
      downloadMedia({
        run: runTool,
        ytDlp: request.ytDlp,
        ffmpegDir: request.ffmpegDir,
        url: request.url,
        outDir: request.outDir,
        parts: request.parts,
        signal,
        onProgress: (pct) => onEvent({ kind: "import-progress", stage: "Downloading", pct }),
      }),
    matchClip: (request, signal) => matchClipFiles(request, signal),
  });
});
