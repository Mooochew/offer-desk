import type { RemoteType, SourceName } from "@/lib/sources/types";

/** Data access the agent needs, bound to one verified user. Supabase in production, in-memory in tests. */

export const STAGES = ["saved", "applied", "screen", "interview", "offer", "rejected", "archived"] as const;
export type Stage = (typeof STAGES)[number];

export type RefKind = "posting" | "application" | "file" | "result_set";

/** A stored posting without its description (the agent model never sees posting text). */
export type PostingInfo = {
  id: string;
  source: SourceName | "snapshot";
  sourceId: string;
  company: string;
  title: string;
  location: string | null;
  locations: string[];
  remote: RemoteType;
  url: string;
  postedAt: string | null;
  employmentType: string | null;
};

export type Application = {
  id: string;
  postingId: string;
  stage: Stage;
  appliedAt: string | null;
  nextStepAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationPatch = Partial<Pick<Application, "stage" | "appliedAt" | "nextStepAt" | "notes">>;

export type ApplicationFilter = {
  ids?: string[];
  postingIds?: string[];
  stages?: Stage[];
  /** Only applications last updated before this time. */
  updatedBefore?: string;
};

export type FileKind = "csv" | "checklist" | "ics";

export type StoredFile = {
  id: string;
  kind: FileKind;
  filename: string;
  storagePath: string;
  supersedesId: string | null;
  createdAt: string;
};

export type ResultSet = {
  id: string;
  ref: string;
  query: unknown;
  postingIds: string[];
  breakdown: unknown;
  ranked: unknown;
  createdAt: string;
};

export type ActionStatus =
  | "proposed"
  | "invalid"
  | "awaiting_confirmation"
  | "confirmed"
  | "executed"
  | "failed"
  | "rejected"
  | "expired";

export type ActionRecord = {
  id: string;
  turnId: string;
  tool: string;
  destructive: boolean;
  args: unknown;
  resolvedArgs: unknown;
  preview: unknown;
  status: ActionStatus;
  resultSummary: string | null;
  error: string | null;
  durationMs: number | null;
  expiresAt: string | null;
  createdAt: string;
};

export type ActionPatch = Partial<Pick<ActionRecord, "status" | "resolvedArgs" | "preview" | "resultSummary" | "error" | "durationMs" | "expiresAt">>;

/** The profile row as stored (profiles table). */
export type StoredProfile = {
  name: string | null;
  skills: string[];
  places: string[];
  remoteOk: boolean;
  maxYears: number;
  excludeClearanceEligible: boolean;
};

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string; createdAt: string };

export interface AgentStore {
  readonly userId: string;

  // Short refs (J12, A3, F2, S1), scoped to this user.
  getRefsForTargets(kind: RefKind, targetIds: string[]): Promise<Map<string, string>>;
  getRefs(refs: string[]): Promise<Map<string, { kind: RefKind; targetId: string }>>;
  /** Inserts a ref; returns false if this target already has a ref (a concurrent request won). */
  insertRef(ref: string, kind: RefKind, targetId: string): Promise<boolean>;
  /** Atomic counter (increment_counter). */
  increment(key: string, ttlSeconds: number): Promise<number>;

  getProfile(): Promise<StoredProfile | null>;
  saveProfile(profile: StoredProfile): Promise<void>;

  getPostings(ids: string[]): Promise<PostingInfo[]>;
  getDescription(id: string): Promise<string | null>;

  listApplications(filter?: ApplicationFilter): Promise<Application[]>;
  /** Creates applications for postings not already in the pipeline; returns only the new ones. */
  createApplications(rows: { postingId: string; stage: Stage; appliedAt?: string | null; nextStepAt?: string | null }[]): Promise<Application[]>;
  updateApplications(ids: string[], patch: ApplicationPatch): Promise<number>;
  deleteApplications(ids: string[]): Promise<number>;

  createResultSet(row: { id: string; ref: string; query: unknown; postingIds: string[]; sourceStatus: unknown; breakdown: unknown }): Promise<void>;
  getResultSet(id: string): Promise<ResultSet | null>;
  latestResultSet(): Promise<ResultSet | null>;
  saveRanked(id: string, ranked: unknown): Promise<void>;

  createFile(row: { kind: FileKind; filename: string; storagePath: string; supersedesId: string | null }): Promise<StoredFile>;
  getFiles(ids: string[]): Promise<StoredFile[]>;
  latestFile(kind: FileKind): Promise<StoredFile | null>;
  recentFiles(limit: number): Promise<StoredFile[]>;
  deleteFiles(ids: string[]): Promise<number>;
  upload(path: string, body: string, contentType: string): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  removeObjects(paths: string[]): Promise<void>;

  insertAction(row: { turnId: string; tool: string; destructive: boolean; args: unknown; status: ActionStatus }): Promise<string>;
  updateAction(id: string, patch: ActionPatch): Promise<void>;
  getAction(id: string): Promise<ActionRecord | null>;
  /** One conditional update: awaiting_confirmation and not expired → confirmed. Null if it didn't apply. */
  claimAction(id: string, now: string): Promise<ActionRecord | null>;
  /** One conditional update: awaiting_confirmation → rejected. Null if it didn't apply. */
  rejectAction(id: string): Promise<ActionRecord | null>;
  pendingActions(now: string): Promise<ActionRecord[]>;
  /** Most recent actions, newest first (the action log panel). */
  listActions(limit: number): Promise<ActionRecord[]>;
  /** Marks proposals past their expiry as "expired" (so the log never shows stale "awaiting"). Returns how many. */
  expireActions(now: string): Promise<number>;

  addMessage(turnId: string, role: ChatMessage["role"], content: string): Promise<void>;
  /** Most recent messages, oldest first. */
  recentMessages(limit: number): Promise<ChatMessage[]>;
}
