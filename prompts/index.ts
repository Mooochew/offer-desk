import { EXTRACT_V1 } from "./extract-v1";
import { EXTRACT_V2 } from "./extract-v2";
import type { ExtractionPrompt } from "./types";

/** Every extraction prompt version, for the eval and for pinning in production. */
export const EXTRACTION_PROMPTS: Record<string, ExtractionPrompt> = {
  [EXTRACT_V1.version]: EXTRACT_V1,
  [EXTRACT_V2.version]: EXTRACT_V2,
};

/** The version the app uses. v2 replaced v1 after the eval (98.3% vs 83.8%, PROMPTS.md). */
export const CURRENT_EXTRACTION_PROMPT = EXTRACT_V2;
