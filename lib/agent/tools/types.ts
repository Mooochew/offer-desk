import type { z } from "zod";
import type { SearchCriteria } from "@/lib/search/filter";
import type { SearchResult } from "@/lib/search/search-jobs";
import type { Profile } from "@/lib/profile/types";
import type { BoardJob } from "@/lib/sources/types";
import type { RequirementFilters } from "@/lib/triage/filter";
import type { TriageResult } from "@/lib/triage/triage";
import type { AgentStore } from "../store";

/** Search and triage, injected so tools can be tested without the network or the model. */
export type AgentServices = {
  search(criteria: SearchCriteria, deadline: number): Promise<SearchResult>;
  triage(jobs: BoardJob[], profile: Profile, filters: RequirementFilters, deadline: number): Promise<TriageResult>;
};

export type ToolContext = {
  store: AgentStore;
  services: AgentServices;
  turnId: string;
  now: () => Date;
  /** IANA timezone of the user's browser, validated (e.g. "America/Los_Angeles"). */
  timezone: string;
  /** Epoch ms: tools that can run long (search, triage) must finish their work by this time. */
  deadline: number;
};

/** Full payloads for the UI. The model never sees these, only `forModel`. */
export type UiPayload = { kind: string; [key: string]: unknown };

export type ToolResult = {
  /** Small, safe summary for the model: refs, enums, counts, scores. Never posting text or quotes. */
  forModel: unknown;
  forUI?: UiPayload;
  /** One line for the action log. */
  summary: string;
};

export type Preview = { title: string; count: number; items: { ref: string; label: string; detail: string }[] };

type ToolBase<A> = {
  name: string;
  description: string;
  /** Zod schema for the arguments. Arguments are validated before anything runs. */
  input: z.ZodType<A>;
};

export type NormalTool<A> = ToolBase<A> & {
  destructive: false;
  run(args: A, ctx: ToolContext): Promise<ToolResult>;
};

/**
 * A destructive tool never runs from the model's call. `prepare` resolves and validates the exact
 * targets and builds a preview; the user confirms; then `execute` runs the STORED resolved args.
 */
export type DestructiveTool<A, R> = ToolBase<A> & {
  destructive: true;
  resolved: z.ZodType<R>;
  prepare(args: A, ctx: ToolContext): Promise<{ resolved: R; preview: Preview }>;
  execute(resolved: R, ctx: ToolContext): Promise<ToolResult>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = NormalTool<any> | DestructiveTool<any, any>;
