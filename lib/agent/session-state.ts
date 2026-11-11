import type { ActionRecord, AgentStore, Application, PostingInfo, StoredFile, StoredProfile } from "./store";
import { isStoredTriage, toBoardJob } from "./tools/shared";
import type { BoardJob } from "@/lib/sources/types";

const LOG_ROWS = 60;
const MESSAGES = 30;
const SEARCH_ROWS = 50;

export type PipelineItem = { ref: string | null; application: Application; posting: PostingInfo };
export type ResultsView = {
  set: string;
  query: unknown;
  triaged: boolean;
  searchBreakdown: unknown;
  /** Source chips for the search ({ sources, usedSnapshot }), so they survive a reload (review N1). */
  sourceStatus: unknown;
  breakdown: unknown;
  ranked: { ref: string; job: BoardJob; score: unknown; why: string; extraction: unknown }[];
  dropped: { ref: string; job: BoardJob; reason: string; evidence: string | null }[];
  unread: { ref: string; job: BoardJob; reason: string }[];
  notChecked: { ref: string | null; job: BoardJob }[];
  /** Untriaged search results (newest first). */
  jobs: (BoardJob & { ref: string | null })[];
};

export type SessionState = {
  profile: StoredProfile | null;
  pipeline: PipelineItem[];
  files: (Pick<StoredFile, "id" | "kind" | "filename" | "createdAt"> & { ref: string | null })[];
  actions: ActionRecord[];
  messages: { role: string; content: string; createdAt: string }[];
  results: ResultsView | null;
};

/**
 * Everything the UI shows after a reload, read for one user (Phase 5). Posting details come from
 * the shared table the browser can't read (RLS), so this runs on the server. It never assigns new
 * refs: items without one show none. Stale proposals are expired first, like buildState.
 */
export async function loadSessionState(store: AgentStore, now: Date): Promise<SessionState> {
  await store.expireActions(now.toISOString());
  const [profile, applications, files, actions, messages, latest] = await Promise.all([
    store.getProfile(),
    store.listApplications({}),
    store.recentFiles(20),
    store.listActions(LOG_ROWS),
    store.recentMessages(MESSAGES),
    store.latestResultSet(),
  ]);

  const triage = latest && isStoredTriage(latest.ranked) ? latest.ranked : null;
  const resultIds = triage
    ? [...triage.ranked, ...triage.dropped, ...triage.unread, ...triage.notChecked].map((item) => item.postingId)
    : (latest?.postingIds.slice(0, SEARCH_ROWS) ?? []);
  const postingIds = [...new Set([...applications.map((app) => app.postingId), ...resultIds])];

  const [postings, appRefs, jobRefs, fileRefs] = await Promise.all([
    store.getPostings(postingIds),
    store.getRefsForTargets("application", applications.map((app) => app.id)),
    store.getRefsForTargets("posting", resultIds),
    store.getRefsForTargets("file", files.map((file) => file.id)),
  ]);
  const byId = new Map(postings.map((posting) => [posting.id, posting]));
  const job = (id: string) => (byId.has(id) ? toBoardJob(byId.get(id)!) : null);

  let results: ResultsView | null = null;
  if (latest) {
    results = {
      set: latest.ref,
      query: latest.query,
      triaged: Boolean(triage),
      searchBreakdown: latest.breakdown,
      sourceStatus: latest.sourceStatus ?? null,
      breakdown: triage?.breakdown ?? null,
      ranked: (triage?.ranked ?? []).flatMap((item) => {
        const posting = job(item.postingId);
        return posting ? [{ ref: item.ref, job: posting, score: item.score, why: item.why, extraction: item.extraction }] : [];
      }),
      dropped: (triage?.dropped ?? []).flatMap((item) => {
        const posting = job(item.postingId);
        return posting ? [{ ref: item.ref, job: posting, reason: item.reason, evidence: item.evidence }] : [];
      }),
      unread: (triage?.unread ?? []).flatMap((item) => {
        const posting = job(item.postingId);
        return posting ? [{ ref: item.ref, job: posting, reason: item.reason }] : [];
      }),
      notChecked: (triage?.notChecked ?? []).flatMap((item) => {
        const posting = job(item.postingId);
        return posting ? [{ ref: item.ref, job: posting }] : [];
      }),
      jobs: triage ? [] : resultIds.flatMap((id) => (job(id) ? [{ ...job(id)!, ref: jobRefs.get(id) ?? null }] : [])),
    };
  }

  return {
    profile,
    pipeline: applications.flatMap((application) => {
      const posting = byId.get(application.postingId);
      return posting ? [{ ref: appRefs.get(application.id) ?? null, application, posting }] : [];
    }),
    files: files.map((file) => ({ id: file.id, kind: file.kind, filename: file.filename, createdAt: file.createdAt, ref: fileRefs.get(file.id) ?? null })),
    actions,
    messages: messages.filter((message) => message.role !== "system"),
    results,
  };
}
