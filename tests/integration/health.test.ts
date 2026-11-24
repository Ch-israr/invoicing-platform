import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns ok with database status", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      db: string;
      time: string;
    };
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.time).toBe("string");
  });
});
