"use client";

import type { TurnEvent } from "@/lib/agent/loop";
import type { SessionState } from "@/lib/agent/session-state";
import { authedFetch } from "@/lib/supabase/browser";

export type TurnResponse = { ok: true; turnId: string; events: TurnEvent[]; final: string } | { ok: false; error: string; retryAfterSeconds?: number };

async function post<T>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await authedFetch(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = { ok: false, error: `The server answered HTTP ${response.status}.` };
  }
  return { status: response.status, body: parsed as T };
}

export const api = {
  state: () => post<({ ok: true } & SessionState) | { ok: false; error: string }>("/api/state"),
  turn: (message: string) => post<TurnResponse>("/api/agent", { message, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  confirm: (actionId: string) => post<{ ok: boolean; status: string; summary?: string; error?: string }>(`/api/actions/${actionId}/confirm`),
  reject: (actionId: string) => post<{ ok: boolean; status: string; error?: string }>(`/api/actions/${actionId}/reject`),
  demoProfile: () => post<{ ok: boolean; error?: string }>("/api/demo/profile"),
  demoSeed: () => post<{ ok: boolean; created?: number; error?: string }>("/api/demo/seed"),
  fileUrl: (fileId: string) => post<{ ok: boolean; url?: string; error?: string }>(`/api/files/${fileId}/url`),
};
