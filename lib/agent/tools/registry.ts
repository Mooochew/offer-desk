import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import { createInterviewInviteTool, deleteFilesTool, exportCsvTool, generateApplyChecklistTool } from "./files";
import { getPostingTool, searchJobsTool, triageResultsTool } from "./jobs";
import {
  addNoteTool,
  archiveApplicationsTool,
  deleteApplicationsTool,
  getFunnelStatsTool,
  listPipelineTool,
  saveToPipelineTool,
  updateStageTool,
} from "./pipeline";
import { updateProfileTool } from "./profile";
import type { AnyTool } from "./types";

/** Every tool the agent can call. Anything else the model names is rejected. */
export const TOOLS: readonly AnyTool[] = [
  searchJobsTool,
  triageResultsTool,
  getPostingTool,
  updateProfileTool,
  saveToPipelineTool,
  updateStageTool,
  addNoteTool,
  listPipelineTool,
  getFunnelStatsTool,
  archiveApplicationsTool,
  deleteApplicationsTool,
  exportCsvTool,
  generateApplyChecklistTool,
  createInterviewInviteTool,
  deleteFilesTool,
];

export type Registry = ReadonlyMap<string, AnyTool>;

export function createRegistry(tools: readonly AnyTool[] = TOOLS): Registry {
  const registry = new Map<string, AnyTool>();
  for (const tool of tools) {
    if (registry.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    registry.set(tool.name, tool);
  }
  return registry;
}

/**
 * OpenAI function definitions generated from the same zod schemas the executor validates with,
 * so the schema the model sees can't drift from the one enforced. Not `strict`: strict mode
 * needs every field required, and optional fields are the point here; zod enforces the rest.
 */
export function toOpenAITools(registry: Registry): FunctionTool[] {
  return [...registry.values()].map((tool) => {
    const parameters = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete parameters.$schema;
    return { type: "function", name: tool.name, description: tool.description, parameters, strict: false };
  });
}
