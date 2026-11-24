import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  advanceNextRun,
  daysBetween,
  isoDate,
  makeRunKey,
  parseIsoDate,
} from "@/lib/recurring-dates";

const d = (iso: string) => parseIsoDate(iso);

describe("addMonthsClamped", () => {
  it("clamps 31 Jan to 28 Feb (non-leap year)", () => {
    expect(isoDate(addMonthsClamped(d("2026-01-31"), 1))).toBe("2026-02-28");
  });
  it("clamps 31 Jan to 29 Feb in a leap year", () => {
    expect(isoDate(addMonthsClamped(d("2024-01-31"), 1))).toBe("2024-02-29");
  });
  it("clamps 29 Feb 2024 to 28 Feb 2025", () => {
    expect(isoDate(addMonthsClamped(d("2024-02-29"), 12))).toBe("2025-02-28");
  });
  it("keeps the day when the target month has it", () => {
    expect(isoDate(addMonthsClamped(d("2026-03-15"), 1))).toBe("2026-04-15");
  });
  it("clamps 31 Mar to 30 Apr", () => {
    expect(isoDate(addMonthsClamped(d("2026-03-31"), 1))).toBe("2026-04-30");
  });
});

describe("advanceNextRun", () => {
  it("weekly advances 7 days", () => {
    expect(isoDate(advanceNextRun(d("2026-11-24"), "WEEKLY"))).toBe("2026-12-01");
  });
  it("monthly advances one clamped month", () => {
    expect(isoDate(advanceNextRun(d("2026-01-31"), "MONTHLY"))).toBe("2026-02-28");
    // The clamped date then advances from the 28th — the schedule
    // does not snap back to the 31st.
    expect(isoDate(advanceNextRun(d("2026-02-28"), "MONTHLY"))).toBe("2026-03-28");
  });
  it("quarterly advances three clamped months", () => {
    expect(isoDate(advanceNextRun(d("2026-11-30"), "QUARTERLY"))).toBe("2027-02-28");
  });
  it("yearly advances twelve clamped months", () => {
    expect(isoDate(advanceNextRun(d("2024-02-29"), "YEARLY"))).toBe("2025-02-28");
  });
  it("custom advances by intervalDays", () => {
    expect(isoDate(advanceNextRun(d("2026-11-24"), "CUSTOM", 10))).toBe("2026-12-04");
  });
  it("custom without intervalDays throws", () => {
    expect(() => advanceNextRun(d("2026-11-24"), "CUSTOM")).toThrow(
      /intervalDays/,
    );
  });
});

describe("makeRunKey / daysBetween", () => {
  it("keys one schedule period", () => {
    expect(makeRunKey("sched-1", d("2026-11-24"))).toBe("sched-1:2026-11-24");
    expect(makeRunKey("sched-1", d("2026-11-25"))).not.toBe(
      makeRunKey("sched-1", d("2026-11-24")),
    );
  });
  it("counts whole days", () => {
    expect(daysBetween(d("2026-11-24"), d("2026-12-24"))).toBe(30);
    expect(daysBetween(d("2026-12-24"), d("2026-11-24"))).toBe(-30);
  });
});
