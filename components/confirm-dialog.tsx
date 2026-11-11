"use client";

import { useEffect, useRef, useState } from "react";
import type { Preview } from "@/lib/agent/tools/types";
import { IconAlert } from "./icons";
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
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-[0_24px_48px_rgba(0,0,0,0.18)] backdrop:bg-black/40 backdrop:backdrop-blur-[1px]"
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${deleting ? "bg-critical-soft text-critical" : "bg-warning-soft text-warning"}`}>
            <IconAlert size={15} />
          </span>
          <div>
            <h2 id="confirm-title" className="text-base font-semibold">{action.preview.title}</h2>
            <p className="mt-1 text-sm text-muted">
              {deleting ? "This permanently deletes them." : "Archived applications leave the board but are kept."} Nothing changes until you confirm.
              {minutesLeft !== null && ` This request expires in ${minutesLeft} min.`}
            </p>
          </div>
        </div>
        <ul className="scroll-thin mt-4 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
          {action.preview.items.map((item) => (
            <li key={item.ref} className="flex items-baseline gap-3 px-3 py-2">
              <span className="font-mono text-[11px] text-muted">{item.ref}</span>
              <span className="min-w-0 flex-1 break-words">{item.label}</span>
              <span className="shrink-0 text-xs text-muted">{item.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">This list was resolved by code. Confirm runs exactly these {action.preview.count}.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-surface-2/60 px-5 py-3">
        <Button autoFocus onClick={() => run("cancel")} disabled={busy !== null}>{busy === "cancel" ? <Spinner /> : "Cancel"}</Button>
        <Button variant={deleting ? "danger" : "primary"} onClick={() => run("confirm")} disabled={busy !== null}>
          {busy === "confirm" ? <Spinner /> : `Confirm (${action.preview.count})`}
        </Button>
      </div>
    </dialog>
  );
}
