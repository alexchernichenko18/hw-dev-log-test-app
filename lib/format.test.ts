import { describe, expect, it } from "vitest";
import { formatAge } from "@/lib/format";

describe("formatAge", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");
  it("reads naturally after 'Created'", () => {
    expect(formatAge("2026-11-24T08:00:00.000Z", now)).toBe("today");
    expect(formatAge("2026-11-23T08:00:00.000Z", now)).toBe("1 day ago");
    expect(formatAge("2026-11-12T08:00:00.000Z", now)).toBe("12 days ago");
  });
});
