// Starts the one utilityProcess worker and hands it a MessagePort.
import { MessageChannelMain, type UtilityProcess, utilityProcess } from "electron";
import workerPath from "../worker/index?modulePath";
import { createWorkerClient, electronPort, type WorkerClient } from "../shared/port";

export class WorkerHost {
  private child: UtilityProcess | undefined;
  private client: WorkerClient | undefined;

  /** The current worker client, starting a worker if none is running. */
  get(): WorkerClient {
    if (this.client === undefined) this.start();
    return this.client!;
  }

  start(): void {
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: "Alcyo worker",
      stdio: "inherit",
    });
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "init" }, [port1]);
    const client = createWorkerClient(electronPort(port2));

    child.once("exit", (code) => {
      client.close(`The worker stopped (exit code ${code}). It restarts on the next request.`);
      port2.close();
      if (this.child === child) {
        this.child = undefined;
        this.client = undefined;
      }
    });

    this.child = child;
    this.client = client;
  }

  stop(): void {
    this.child?.kill();
  }
}
