// Download button for the whisper model. Progress arrives as model:progress
// while setup:downloadModel is in flight.
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/parts";
import { toast } from "../ui/toast";
import { useSetup } from "./store";

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Press Download again.";
}

export function DownloadButton() {
  const load = useSetup((s) => s.load);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);

  useEffect(
    () =>
      window.alcyo.on("model:progress", (progress) => {
        setPct(
          progress.total === null || progress.total === 0
            ? null
            : Math.round((progress.received / progress.total) * 100),
        );
      }),
    [],
  );

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      data-testid="download-model"
      onClick={() => {
        setBusy(true);
        void window.alcyo
          .invoke("setup:downloadModel", {})
          .then(
            () => load(true),
            (error: unknown) => toast("The model didn't download", messageOf(error)),
          )
          .finally(() => setBusy(false));
      }}
    >
      {busy && <Spinner size={14} />}
      {busy ? (pct === null ? "Downloading…" : `Downloading ${pct}%`) : "Download"}
    </Button>
  );
}
