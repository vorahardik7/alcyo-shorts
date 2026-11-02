// Starts the built app (or a packaged one, with ALCYO_E2E_EXECUTABLE) in
// headless mode with a throwaway profile. Nothing shows on screen.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import electronBinary from "electron";

const appDir = join(import.meta.dirname, "..");
const packaged = process.env["ALCYO_E2E_EXECUTABLE"];

/** The command that starts the app, for both Playwright and a raw second instance. */
export const command =
  packaged !== undefined && packaged.length > 0
    ? { executable: packaged, args: [] as string[] }
    : {
        executable: electronBinary as unknown as string,
        args: [join(appDir, "out", "main", "index.js")],
      };

export type SetupMode = "pass" | "fail" | "real";

export function appEnv(userData: string, setup: SetupMode): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "ELECTRON_RENDERER_URL" && k !== "ELECTRON_RUN_AS_NODE")
      vars[k] = v;
  }
  vars["ALCYO_USER_DATA"] = userData;
  vars["ALCYO_HEADLESS"] = "1";
  vars["ALCYO_TEST_SETUP"] = setup;
  // New streams go inside the throwaway profile, never ~/Movies.
  vars["ALCYO_STREAMS_DIR"] ??= join(userData, "Streams");
  return vars;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  env: Record<string, string>;
  close: () => Promise<void>;
}

export async function launch(
  setup: SetupMode = "pass",
  extraEnv: Record<string, string> = {},
): Promise<Launched> {
  const userData = mkdtempSync(join(tmpdir(), "alcyo-e2e-"));
  const env = { ...appEnv(userData, setup), ...extraEnv };
  const app = await electron.launch({
    executablePath: command.executable,
    args: command.args,
    env,
  });
  const page = await app.firstWindow();
  return {
    app,
    page,
    env,
    close: async () => {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** Makes main's next file dialogs answer with these paths (null = cancelled). */
export async function stubFileDialog(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    const answer = () =>
      Promise.resolve(
        chosen === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [chosen] },
      );
    dialog.showOpenDialog = answer;
  }, path);
}
