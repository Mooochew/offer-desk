import type { AgentStore } from "./store";
import { SIGNED_URL_SECONDS } from "./tools/files";

/**
 * A fresh signed download link for one of the user's files (links expire after an hour). The
 * store is user-scoped, so another user's file id is simply not found; the store also refuses
 * storage paths outside the user's folder (Phase 4 review S5).
 */
export async function freshFileLink(store: AgentStore, fileId: string): Promise<{ url: string; filename: string; expiresInSeconds: number } | null> {
  const [file] = await store.getFiles([fileId]);
  if (!file) return null;
  return { url: await store.signedUrl(file.storagePath, SIGNED_URL_SECONDS), filename: file.filename, expiresInSeconds: SIGNED_URL_SECONDS };
}
