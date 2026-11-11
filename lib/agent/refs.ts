import { mapWithConcurrency } from "@/lib/util/concurrency";
import { ToolError } from "./errors";
import type { AgentStore, RefKind } from "./store";

/**
 * Short refs: the model sees `J12` (posting), `A3` (application), `F2` (file), `S1` (result set),
 * never a UUID, so it can't invent or mistype one. Refs are per user: another session's refs are
 * simply unknown here (PLAN 4.4, DECISIONS 019/032).
 */
export const REF_PREFIX: Record<RefKind, string> = { posting: "J", application: "A", file: "F", result_set: "S" };
const KIND_BY_PREFIX: Record<string, RefKind> = { J: "posting", A: "application", F: "file", S: "result_set" };
const KIND_NAME: Record<RefKind, string> = { posting: "job (J#)", application: "application (A#)", file: "file (F#)", result_set: "result set (S#)" };

export const REF_PATTERN = /^[JAFS][1-9]\d{0,6}$/;

/** Ten years: the counter must outlive the refs it numbers (DECISIONS 032). */
const REF_COUNTER_TTL = 10 * 365 * 24 * 60 * 60;

/** Gives each target a ref, reusing existing ones. New numbers come from an atomic counter. */
export async function assignRefs(store: AgentStore, kind: RefKind, targetIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(targetIds)];
  const refs = await store.getRefsForTargets(kind, unique);
  const missing = unique.filter((id) => !refs.has(id));
  let lostRace = false;

  await mapWithConcurrency(missing, 8, async (targetId) => {
    const number = await store.increment(`ref:${store.userId}:${kind}`, REF_COUNTER_TTL);
    const ref = `${REF_PREFIX[kind]}${number}`;
    if (await store.insertRef(ref, kind, targetId)) refs.set(targetId, ref);
    else lostRace = true;
  });

  if (lostRace || refs.size < unique.length) {
    // A concurrent request gave some targets a ref first; use theirs.
    for (const [id, ref] of await store.getRefsForTargets(kind, unique.filter((id) => !refs.has(id)))) refs.set(id, ref);
  }
  const unassigned = unique.filter((id) => !refs.has(id));
  if (unassigned.length) throw new Error(`could not assign ${unassigned.length} ${kind} ref(s)`);
  return refs;
}

export function normalizeRef(ref: string): string {
  return ref.trim().toUpperCase();
}

export type ResolvedRef = { ref: string; kind: RefKind; targetId: string };

/**
 * Maps refs to this user's targets. Unknown refs (including another user's) and refs of the
 * wrong kind are rejected with a message the model can act on.
 */
export async function resolveRefs(store: AgentStore, refs: string[], allowed: RefKind[]): Promise<ResolvedRef[]> {
  const normalized = [...new Set(refs.map(normalizeRef))];
  const malformed = normalized.filter((ref) => !REF_PATTERN.test(ref));
  if (malformed.length) throw new ToolError("bad_ref", `Not a valid reference: ${malformed.join(", ")}. Use refs like J3, A2, F1, S1 from earlier results.`);

  const wrongKind = normalized.filter((ref) => !allowed.includes(KIND_BY_PREFIX[ref[0]]));
  if (wrongKind.length) {
    throw new ToolError("wrong_ref_kind", `${wrongKind.join(", ")} can't be used here; this needs a ${allowed.map((kind) => KIND_NAME[kind]).join(" or ")}.`);
  }

  const found = await store.getRefs(normalized);
  const unknown = normalized.filter((ref) => !found.has(ref));
  if (unknown.length) throw new ToolError("unknown_ref", `Unknown reference: ${unknown.join(", ")}. Only use refs shown in this conversation's results.`);

  return normalized.map((ref) => ({ ref, ...found.get(ref)! }));
}
