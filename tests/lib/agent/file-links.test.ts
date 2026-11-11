import { describe, expect, it } from "vitest";
import { freshFileLink } from "@/lib/agent/file-links";
import { memoryDb } from "./memory-store";

describe("freshFileLink", () => {
  it("signs a fresh link for the user's own file", async () => {
    const { storeFor } = memoryDb();
    const file = await storeFor("u1").createFile({ kind: "csv", filename: "jobs.csv", storagePath: "u1/a/jobs.csv", supersedesId: null });
    expect(await freshFileLink(storeFor("u1"), file.id)).toEqual({ url: expect.stringContaining("u1/a/jobs.csv"), filename: "jobs.csv", expiresInSeconds: 3600 });
  });

  it("doesn't find another user's file", async () => {
    const { storeFor } = memoryDb();
    const file = await storeFor("victim").createFile({ kind: "csv", filename: "jobs.csv", storagePath: "victim/a/jobs.csv", supersedesId: null });
    expect(await freshFileLink(storeFor("attacker"), file.id)).toBeNull();
    expect(await freshFileLink(storeFor("attacker"), crypto.randomUUID())).toBeNull();
  });
});
