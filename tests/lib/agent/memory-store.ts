import type { ActionRecord, AgentStore, Application, ChatMessage, PostingInfo, RefKind, ResultSet, StoredFile, StoredProfile } from "@/lib/agent/store";
import type { AgentServices, ToolContext } from "@/lib/agent/tools/types";
import type { SearchResult } from "@/lib/search/search-jobs";
import type { BoardJob } from "@/lib/sources/types";
import type { TriageResult } from "@/lib/triage/triage";

/**
 * One in-memory database shared by many users, so tests can check that one user's store never
 * sees another user's rows (the Supabase store filters every query by user_id, and RLS backs that).
 */
export function memoryDb(now: () => Date = () => new Date("2026-11-10T20:00:00Z")) {
  const db = {
    now,
    postings: new Map<string, PostingInfo & { description: string | null }>(),
    refs: [] as { userId: string; ref: string; kind: RefKind; targetId: string }[],
    counters: new Map<string, number>(),
    profiles: new Map<string, StoredProfile>(),
    applications: [] as (Application & { userId: string })[],
    resultSets: [] as (ResultSet & { userId: string })[],
    files: [] as (StoredFile & { userId: string })[],
    objects: new Map<string, { body: string; contentType: string }>(),
    actions: [] as (ActionRecord & { userId: string })[],
    messages: [] as (ChatMessage & { userId: string; turnId: string })[],
    /** Ticks so rows created in one test get increasing timestamps. */
    clock: 0,
  };
  const stamp = () => new Date(now().getTime() + db.clock++).toISOString();

  function storeFor(userId: string): AgentStore {
    const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((row) => row.userId === userId);
    return {
      userId,
      async getRefsForTargets(kind, targetIds) {
        return new Map(mine(db.refs).filter((row) => row.kind === kind && targetIds.includes(row.targetId)).map((row) => [row.targetId, row.ref]));
      },
      async getRefs(refs) {
        return new Map(mine(db.refs).filter((row) => refs.includes(row.ref)).map((row) => [row.ref, { kind: row.kind, targetId: row.targetId }]));
      },
      async insertRef(ref, kind, targetId) {
        if (mine(db.refs).some((row) => row.ref === ref)) throw new Error(`duplicate ref ${ref}`);
        if (mine(db.refs).some((row) => row.kind === kind && row.targetId === targetId)) return false;
        db.refs.push({ userId, ref, kind, targetId });
        return true;
      },
      async increment(key) {
        const next = (db.counters.get(key) ?? 0) + 1;
        db.counters.set(key, next);
        return next;
      },
      async getProfile() {
        return db.profiles.get(userId) ?? null;
      },
      async saveProfile(profile) {
        db.profiles.set(userId, structuredClone(profile));
      },
      async getPostings(ids) {
        return ids.flatMap((id) => {
          const posting = db.postings.get(id);
          if (!posting) return [];
          return [structuredClone(withoutDescription(posting))];
        });
      },
      async getDescription(id) {
        return db.postings.get(id)?.description ?? null;
      },
      async listApplications(filter = {}) {
        return mine(db.applications)
          .filter((app) => !filter.ids || filter.ids.includes(app.id))
          .filter((app) => !filter.postingIds || filter.postingIds.includes(app.postingId))
          .filter((app) => !filter.stages || filter.stages.includes(app.stage))
          .filter((app) => !filter.updatedBefore || app.updatedAt < filter.updatedBefore)
          .map((app) => {
            const copy: Partial<typeof app> = structuredClone(app);
            delete copy.userId;
            return copy as Application;
          });
      },
      async createApplications(rows) {
        const created: Application[] = [];
        for (const row of rows) {
          if (mine(db.applications).some((app) => app.postingId === row.postingId)) continue;
          const at = stamp();
          const app = { id: crypto.randomUUID(), postingId: row.postingId, stage: row.stage, appliedAt: row.appliedAt ?? null, nextStepAt: row.nextStepAt ?? null, notes: "", createdAt: at, updatedAt: at };
          db.applications.push({ ...app, userId });
          created.push(structuredClone(app));
        }
        return created;
      },
      async updateApplications(ids, patch) {
        const targets = mine(db.applications).filter((app) => ids.includes(app.id));
        for (const app of targets) Object.assign(app, patch, { updatedAt: stamp() });
        return targets.length;
      },
      async deleteApplications(ids) {
        const before = db.applications.length;
        db.applications = db.applications.filter((app) => !(app.userId === userId && ids.includes(app.id)));
        return before - db.applications.length;
      },
      async createResultSet(row) {
        db.resultSets.push({ userId, id: row.id, ref: row.ref, query: row.query, postingIds: row.postingIds, breakdown: row.breakdown, ranked: null, createdAt: stamp() });
      },
      async getResultSet(id) {
        const set = mine(db.resultSets).find((row) => row.id === id);
        return set ? structuredClone(set) : null;
      },
      async latestResultSet() {
        const sets = mine(db.resultSets);
        return sets.length ? structuredClone(sets[sets.length - 1]) : null;
      },
      async saveRanked(id, ranked) {
        const set = mine(db.resultSets).find((row) => row.id === id);
        if (set) set.ranked = structuredClone(ranked);
      },
      async createFile(row) {
        const file = { id: crypto.randomUUID(), createdAt: stamp(), ...row };
        db.files.push({ ...file, userId });
        return file;
      },
      async getFiles(ids) {
        return mine(db.files).filter((file) => ids.includes(file.id));
      },
      async latestFile(kind) {
        const files = mine(db.files).filter((file) => file.kind === kind);
        return files[files.length - 1] ?? null;
      },
      async recentFiles(limit) {
        return mine(db.files).slice(-limit).reverse();
      },
      async deleteFiles(ids) {
        const before = db.files.length;
        db.files = db.files.filter((file) => !(file.userId === userId && ids.includes(file.id)));
        return before - db.files.length;
      },
      async upload(path, body, contentType) {
        if (!path.startsWith(`${userId}/`)) throw new Error("storage path outside the user's folder");
        if (db.objects.has(path)) throw new Error("object exists");
        db.objects.set(path, { body, contentType });
      },
      async signedUrl(path) {
        return `https://storage.test/${path}?token=signed`;
      },
      async removeObjects(paths) {
        for (const path of paths) if (path.startsWith(`${userId}/`)) db.objects.delete(path);
      },
      async insertAction(row) {
        const id = crypto.randomUUID();
        db.actions.push({ userId, id, resolvedArgs: null, preview: null, resultSummary: null, error: null, durationMs: null, expiresAt: null, createdAt: stamp(), ...structuredClone(row) });
        return id;
      },
      async updateAction(id, patch) {
        const action = mine(db.actions).find((row) => row.id === id);
        if (action) Object.assign(action, structuredClone(patch));
      },
      async getAction(id) {
        const action = mine(db.actions).find((row) => row.id === id);
        return action ? structuredClone(action) : null;
      },
      async claimAction(id, at) {
        const action = mine(db.actions).find((row) => row.id === id && row.status === "awaiting_confirmation" && row.destructive && row.expiresAt !== null && row.expiresAt > at);
        if (!action) return null;
        action.status = "confirmed";
        return structuredClone(action);
      },
      async rejectAction(id) {
        const action = mine(db.actions).find((row) => row.id === id && row.status === "awaiting_confirmation");
        if (!action) return null;
        action.status = "rejected";
        return structuredClone(action);
      },
      async pendingActions(at) {
        return mine(db.actions).filter((row) => row.status === "awaiting_confirmation" && row.expiresAt !== null && row.expiresAt > at);
      },
      async listActions(limit) {
        return mine(db.actions).slice(-limit).reverse().map((row) => structuredClone(row));
      },
      async expireActions(at) {
        const stale = mine(db.actions).filter((row) => row.status === "awaiting_confirmation" && row.expiresAt !== null && row.expiresAt <= at);
        for (const row of stale) row.status = "expired";
        return stale.length;
      },
      async addMessage(turnId, role, content) {
        db.messages.push({ userId, turnId, role, content, createdAt: stamp() });
      },
      async recentMessages(limit) {
        return mine(db.messages).slice(-limit).map(({ role, content, createdAt }) => ({ role, content, createdAt }));
      },
    };
  }

  function addPosting(overrides: Partial<PostingInfo> & { description?: string | null } = {}): PostingInfo {
    const id = overrides.id ?? crypto.randomUUID();
    const posting = {
      id,
      source: "greenhouse" as const,
      sourceId: id.slice(0, 8),
      company: "Acme",
      title: "Software Engineer",
      location: "Irvine, CA",
      locations: ["Irvine, CA"],
      remote: "onsite" as const,
      url: `https://jobs.example.com/${id.slice(0, 8)}`,
      postedAt: "2026-11-08T00:00:00.000Z",
      employmentType: null,
      description: "We build things. 1+ years of experience.",
      ...overrides,
    };
    db.postings.set(id, posting);
    return withoutDescription(posting);
  }

  /** Adds an application directly, with chosen timestamps. */
  function addApplication(userId: string, postingId: string, overrides: Partial<Application> = {}): Application {
    const at = now().toISOString();
    const app = { id: crypto.randomUUID(), postingId, stage: "saved" as const, appliedAt: null, nextStepAt: null, notes: "", createdAt: at, updatedAt: at, ...overrides };
    db.applications.push({ ...app, userId });
    return app;
  }

  return { db, storeFor, addPosting, addApplication };
}

function withoutDescription(posting: PostingInfo & { description: string | null }): PostingInfo {
  const copy: Partial<typeof posting> = { ...posting };
  delete copy.description;
  return copy as PostingInfo;
}

export function boardJobFrom(posting: PostingInfo): BoardJob {
  return {
    postingId: posting.id,
    source: posting.source === "snapshot" ? "greenhouse" : posting.source,
    sourceId: posting.sourceId,
    company: posting.company,
    title: posting.title,
    location: posting.location,
    locations: posting.locations,
    remote: posting.remote,
    url: posting.url,
    postedAt: posting.postedAt,
    employmentType: posting.employmentType,
  };
}

export function emptySearch(jobs: BoardJob[] = []): SearchResult {
  return {
    jobs,
    breakdown: { considered: jobs.length + 10, droppedRole: 10, droppedSeniority: 0, droppedInternship: 0, droppedAge: 0, droppedLocation: 0, droppedDuplicates: 0, remaining: jobs.length },
    sources: [{ source: "greenhouse", boards: 3, jobs: jobs.length + 10, cached: 3, refreshed: 0, stale: 0, failed: 0, skipped: 0 }],
    failures: [],
    usedSnapshot: false,
    staleBoards: [],
  };
}

export function emptyTriage(): TriageResult {
  return {
    ranked: [],
    notChecked: [],
    dropped: [],
    unread: [],
    breakdown: { candidates: 0, checked: 0, notChecked: 0, unread: 0, droppedYears: 0, droppedClearance: 0, remaining: 0 },
    cacheHits: 0,
    modelCalls: 0,
  };
}

export function toolContext(store: AgentStore, overrides: Partial<Omit<ToolContext, "services">> & { services?: Partial<AgentServices> } = {}): ToolContext {
  const { services, ...rest } = overrides;
  return {
    store,
    services: { search: async () => emptySearch(), triage: async () => emptyTriage(), ...services },
    turnId: crypto.randomUUID(),
    now: () => new Date("2026-11-10T20:00:00Z"),
    timezone: "America/Los_Angeles",
    deadline: Date.now() + 60_000,
    ...rest,
  };
}
