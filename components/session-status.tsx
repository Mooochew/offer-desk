"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase/browser";

type Status =
  | { state: "loading" }
  | { state: "ready"; userId: string }
  | { state: "error"; message: string };

/** Starts an anonymous session and confirms the server accepts it. */
export function SessionStatus() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    authedFetch("/api/health", { method: "POST" })
      .then(async (response) => {
        const body = await response.json();
        if (!body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        setStatus({ state: "ready", userId: body.userId });
      })
      .catch((error: Error) => setStatus({ state: "error", message: error.message }));
  }, []);

  if (status.state === "loading") {
    return <span className="text-xs text-zinc-500">Starting session…</span>;
  }
  if (status.state === "error") {
    return <span className="text-xs text-red-600">Session error: {status.message}</span>;
  }
  return (
    <span className="text-xs text-zinc-500" title={status.userId}>
      Session {status.userId.slice(0, 8)}
    </span>
  );
}
