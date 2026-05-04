import { describe, expect, test } from "bun:test";
import {
  classifyError,
  FATAL_PATTERNS,
  matchesPattern,
  safeSendMessage,
  TRANSIENT_PATTERNS,
  withRetry,
  type SafeSendMessageResult,
} from "../core/resilience";

describe("classifyError", () => {
  test("classifies fatal errors", () => {
    expect(classifyError(new Error("unauthorized"))).toBe("FATAL");
    expect(classifyError(new Error("authentication failed for user"))).toBe("FATAL");
    expect(classifyError(new Error("403 forbidden"))).toBe("FATAL");
    expect(classifyError(new Error("401 Unauthorized"))).toBe("FATAL");
    expect(classifyError(new Error("credit balance exhausted"))).toBe("FATAL");
    expect(classifyError(new Error("quota exceeded"))).toBe("FATAL");
  });

  test("classifies transient errors", () => {
    expect(classifyError(new Error("connection timeout"))).toBe("TRANSIENT");
    expect(classifyError(new Error("ECONNREFUSED"))).toBe("TRANSIENT");
    expect(classifyError(new Error("rate limit hit"))).toBe("TRANSIENT");
    expect(classifyError(new Error("429 too many requests"))).toBe("TRANSIENT");
    expect(classifyError(new Error("503 service unavailable"))).toBe("TRANSIENT");
    expect(classifyError(new Error("network error"))).toBe("TRANSIENT");
  });

  test("classifies unknown errors", () => {
    expect(classifyError(new Error("something weird happened"))).toBe("UNKNOWN");
    expect(classifyError(new Error(""))).toBe("UNKNOWN");
  });

  test("fatal takes priority over transient", () => {
    // Message contains both fatal and transient patterns
    expect(classifyError(new Error("unauthorized: process exited with code 1"))).toBe("FATAL");
    expect(classifyError(new Error("forbidden but timeout occurred"))).toBe("FATAL");
  });

  test("is case-insensitive", () => {
    expect(classifyError(new Error("UNAUTHORIZED"))).toBe("FATAL");
    expect(classifyError(new Error("TIMEOUT"))).toBe("TRANSIENT");
  });
});

describe("matchesPattern", () => {
  test("matches substrings", () => {
    expect(matchesPattern("hello world", ["world"])).toBe(true);
    expect(matchesPattern("hello world", ["foo"])).toBe(false);
  });

  test("returns true if any pattern matches", () => {
    expect(matchesPattern("error", ["foo", "error", "bar"])).toBe(true);
  });
});

describe("safeSendMessage", () => {
  test("returns value on success", async () => {
    const result = await safeSendMessage(() => 42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
    expect(result.error).toBeUndefined();
  });

  test("returns ok:false for transient errors", async () => {
    const result = await safeSendMessage(() => {
      throw new Error("network error");
    });
    expect(result.ok).toBe(false);
    expect(result.errorType).toBe("TRANSIENT");
    expect(result.error?.message).toBe("network error");
  });

  test("throws for fatal errors", async () => {
    await expect(
      safeSendMessage(() => {
        throw new Error("unauthorized");
      }),
    ).rejects.toThrow("unauthorized");
  });

  test("tracks unknown errors up to threshold", async () => {
    const counter = { count: 0 };
    const fn = () => {
      throw new Error("something weird");
    };

    const r1 = await safeSendMessage(fn, { unknownCounter: counter, unknownThreshold: 3 });
    expect(r1.ok).toBe(false);
    expect(r1.errorType).toBe("UNKNOWN");
    expect(r1.unknownCount).toBe(1);

    const r2 = await safeSendMessage(fn, { unknownCounter: counter, unknownThreshold: 3 });
    expect(r2.ok).toBe(false);
    expect(r2.unknownCount).toBe(2);

    // Third consecutive UNKNOWN exceeds threshold -> throws
    await expect(safeSendMessage(fn, { unknownCounter: counter, unknownThreshold: 3 })).rejects.toThrow(
      "something weird",
    );
  });

  test("resets unknown counter on success", async () => {
    const counter = { count: 0 };
    await safeSendMessage(
      () => {
        throw new Error("weird");
      },
      { unknownCounter: counter, unknownThreshold: 3 },
    );
    expect(counter.count).toBe(1);

    await safeSendMessage(() => "ok", { unknownCounter: counter, unknownThreshold: 3 });
    expect(counter.count).toBe(0);
  });

  test("handles async functions", async () => {
    const result = await safeSendMessage(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return "done";
    });
    expect(result.ok).toBe(true);
    expect(result.value).toBe("done");
  });

  test("wraps non-error throws", async () => {
    const result = await safeSendMessage(() => {
      throw "string error";
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("string error");
  });
});

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(() => 123);
    expect(result).toBe(123);
  });

  test("retries on transient errors then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) throw new Error("timeout");
        return "ok";
      },
      { maxRetries: 3 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("fails immediately on fatal errors", async () => {
    let calls = 0;
    await expect(
      withRetry(() => {
        calls++;
        throw new Error("unauthorized");
      }),
    ).rejects.toThrow("unauthorized");
    expect(calls).toBe(1);
  });

  test("fails immediately on unknown errors", async () => {
    let calls = 0;
    await expect(
      withRetry(() => {
        calls++;
        throw new Error("weird");
      }),
    ).rejects.toThrow("weird");
    expect(calls).toBe(1);
  });

  test("throws last error after exhausting retries", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          throw new Error("timeout");
        },
        { maxRetries: 2 },
      ),
    ).rejects.toThrow("timeout");
    expect(calls).toBe(3); // initial + 2 retries
  });

  test("invokes onRetry callback with correct delays", async () => {
    const retries: Array<{ attempt: number; delay: number }> = [];
    let calls = 0;
    await withRetry(
      () => {
        calls++;
        if (calls < 3) throw new Error("timeout");
        return "ok";
      },
      {
        maxRetries: 3,
        baseDelayMs: 10,
        onRetry: (attempt, _error, delayMs) => {
          retries.push({ attempt, delay: delayMs });
        },
      },
    );
    expect(retries).toEqual([
      { attempt: 1, delay: 10 },
      { attempt: 2, delay: 20 },
    ]);
  });

  test("handles async functions", async () => {
    const result = await withRetry(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return "async-ok";
    });
    expect(result).toBe("async-ok");
  });
});
