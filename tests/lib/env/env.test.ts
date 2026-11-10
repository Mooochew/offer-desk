import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv() {
  vi.resetModules();
  const [publicModule, serverModule] = await Promise.all([
    import("@/lib/env/public"),
    import("@/lib/env/server"),
  ]);
  return { ...publicModule, ...serverModule };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicEnv", () => {
  it("reads the Supabase URL and publishable key", async () => {
    const { publicEnv } = await loadEnv();
    expect(publicEnv.supabaseUrl).toBe("https://test-project.supabase.co");
    expect(publicEnv.supabasePublishableKey).toBe("sb_publishable_test");
  });

  it("rejects a secret key placed in the public variable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_oops");
    await expect(loadEnv()).rejects.toThrow();
  });

  it("rejects a malformed Supabase URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    await expect(loadEnv()).rejects.toThrow();
  });
});

describe("getServerEnv", () => {
  it("defaults both models when the env vars are blank", async () => {
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("OPENAI_EXTRACT_MODEL", "");
    const { getServerEnv } = await loadEnv();
    expect(getServerEnv().openaiModel).toBe("gpt-6-luna");
    expect(getServerEnv().openaiExtractModel).toBe("gpt-6-luna");
  });

  it("treats blank Adzuna keys as not configured", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "");
    vi.stubEnv("ADZUNA_APP_KEY", "");
    const { getServerEnv } = await loadEnv();
    expect(getServerEnv().adzunaAppId).toBeUndefined();
    expect(getServerEnv().adzunaAppKey).toBeUndefined();
  });

  it("rejects a publishable key placed in the secret variable", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_publishable_oops");
    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow();
  });

  it("fails when the OpenAI key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow();
  });

  it("caches the parsed result", async () => {
    const { getServerEnv } = await loadEnv();
    expect(getServerEnv()).toBe(getServerEnv());
  });
});
