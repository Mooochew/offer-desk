import type { Extraction } from "@/lib/triage/schema";

/** One worked example shown to the model before the real posting (few-shot). */
export type ExtractionExample = { posting: string; output: Extraction };

/** A versioned extraction prompt. The version is part of the extraction cache key. */
export type ExtractionPrompt = {
  version: string;
  instructions: string;
  examples: ExtractionExample[];
};
