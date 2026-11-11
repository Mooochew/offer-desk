"use client";

import { useEffect, useRef, useState } from "react";
import type { Preview } from "@/lib/agent/tools/types";
import { Button, Spinner } from "./ui";

/** `minutesLeft` is computed when the dialog opens (an event), so rendering stays pure. */
export type PendingAction = { actionId: string; tool: string; preview: Preview; minutesLeft: number | null };

export function minutesUntil(expiresAt: string | null | undefined, now = Date.now()): number | null {
  return expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - now) / 60_000)) : null;
}

/**
 * The only way a destructive action runs: the user reviews the exact list code resolved, then
 * Confirm sends the action id. The server runs the stored arguments, not anything new from the model.
 */
export function ConfirmDialog({ action, onConfirm, onCancel, onClose }: { action: PendingAction; onConfirm: () => Promise<void>; onCancel: () => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const deleting = action.tool.startsWith("delete");
  const { minutesLeft } = action;

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => node?.close();
  }, []);

  const run = async (kind: "confirm" | "cancel") => {
    setBusy(kind);
    try {
      await (kind === "confirm" ? onConfirm() : onCancel());
    } finally {
      setBusy(null);
    }
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault(); // Escape closes the dialog but leaves the action pending.
        onClose();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="p-4">
        <h2 id="confirm-title" className="text-lg font-semibold">{action.preview.title}</h2>
        <p className="mt-1 text-sm text-muted">
          {deleting ? "This permanently deletes them." : "Archived applications leave the board but are kept."} Nothing changes until you confirm.
          {minutesLeft !== null && ` This request expires in ${minutesLeft} min.`}
        </p>
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-sm">
          {action.preview.items.map((item) => (
            <li key={item.ref} className="flex items-baseline gap-2 border-b border-border py-1 last:border-0">
              <span className="font-mono text-xs text-muted">{item.ref}</span>
              <span className="min-w-0 flex-1 break-words">{item.label}</span>
              <span className="shrink-0 text-xs text-muted">{item.detail}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">
        <Button autoFocus onClick={() => run("cancel")} disabled={busy !== null}>{busy === "cancel" ? <Spinner /> : "Cancel"}</Button>
        <Button variant={deleting ? "danger" : "primary"} onClick={() => run("confirm")} disabled={busy !== null}>
          {busy === "confirm" ? <Spinner /> : `Confirm (${action.preview.count})`}
        </Button>
      </div>
    </dialog>
  );
}
