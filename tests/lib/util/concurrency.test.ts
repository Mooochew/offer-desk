import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/util/concurrency";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("keeps results in input order even when tasks finish out of order", async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(results.map((result) => (result.ok ? result.value : null))).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick(5);
      running--;
    });
    expect(peak).toBe(3);
  });

  it("isolates failures: other tasks still complete", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("board down");
      return n * 10;
    });
    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 30 });
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
