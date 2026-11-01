import type { AppInfo } from "@alcyo/ipc";
import { useEffect, useState } from "react";
import license from "../../../../../../LICENSE?raw";
import notices from "../../../../../../THIRD_PARTY_NOTICES.md?raw";

export function SettingsPage() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let live = true;
    window.alcyo.invoke("app:info", {}).then(
      (result) => live && setInfo(result),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="mx-auto w-full max-w-3xl overflow-y-auto px-8 pt-16 pb-10 select-text">
      <h1 className="text-[22px] font-semibold">Settings</h1>

      <h2 className="mt-8 text-small font-semibold uppercase tracking-wide text-secondary">
        About
      </h2>
      <p data-testid="app-version" className="mt-2">
        {info === null
          ? "Alcyo Shorts"
          : `${info.name} ${info.version} · ${info.platform} ${info.arch} · Electron ${info.electron}`}
      </p>

      <h2 className="mt-8 text-small font-semibold uppercase tracking-wide text-secondary">
        License
      </h2>
      <pre className="mt-2 whitespace-pre-wrap rounded-bubble bg-bubble-claude p-5 font-sans text-small text-secondary">
        {license}
      </pre>

      <h2 className="mt-8 text-small font-semibold uppercase tracking-wide text-secondary">
        Third-party notices
      </h2>
      <pre
        data-testid="notices"
        className="mt-2 whitespace-pre-wrap rounded-bubble bg-bubble-claude p-5 font-sans text-small text-secondary"
      >
        {notices}
      </pre>
    </section>
  );
}
