// Routes alcyo:// links that main sends, and keeps the last bad-link message.
import { appLinkToRoute } from "@alcyo/schema";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export function useLinks(): { notice: string | null; dismiss: () => void } {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const offOpen = window.alcyo.on("link:open", ({ link }) => {
      setNotice(null);
      router.history.push(appLinkToRoute(link));
    });
    const offInvalid = window.alcyo.on("link:invalid", ({ message }) => setNotice(message));
    return () => {
      offOpen();
      offInvalid();
    };
  }, [router]);

  return { notice, dismiss: () => setNotice(null) };
}
