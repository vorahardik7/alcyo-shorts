// The utilityProcess worker. Main sends one { type: "init" } message on the
// parentPort carrying a MessagePort; every job message after that goes over the
// port and is checked against @alcyo/ipc's worker contract.
import { WorkerInit } from "@alcyo/ipc";
import type { MessagePortMain } from "electron";
import { electronPort, serveWorker } from "../shared/port";

process.parentPort.once("message", (event: { data: unknown; ports: MessagePortMain[] }) => {
  const port = event.ports[0];
  if (!WorkerInit.safeParse(event.data).success || port === undefined) {
    console.error("[worker] Expected an init message with a port. Exiting.");
    process.exit(1);
  }
  serveWorker(electronPort(port));
});
