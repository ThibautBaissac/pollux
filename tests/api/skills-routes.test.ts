import { mkdirSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { buildJsonRequest, buildRequest } from "../helpers/requests";
import { createTestDb, type TestDbContext } from "../helpers/test-db";

describe("skills API routes", () => {
  let testDb: TestDbContext;
  let skillsDir = "";

  beforeEach(() => {
    testDb = createTestDb();
    skillsDir = join(testDb.rootDir, "data", "skills");
    mkdirSync(skillsDir, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(testDb.rootDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testDb.cleanup();
  });

  function writeSkill(name: string, description = "Test skill.", body = "Body here.\n") {
    const dir = join(skillsDir, name);
    mkdirSync(dir, { recursive: true });
    const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
    writeFileSync(join(dir, "SKILL.md"), frontmatter, "utf-8");
    return dir;
  }

  async function loadRoutes(
    requireAuthImpl: () => Promise<Response | null> = async () => null,
  ) {
    vi.resetModules();
    vi.doMock("@/lib/auth-guard", () => ({ requireAuth: requireAuthImpl }));
    const [collection, item, files] = await Promise.all([
      import("@/app/api/skills/route"),
      import("@/app/api/skills/[name]/route"),
      import("@/app/api/skills/[name]/files/[...path]/route"),
    ]);
    return { collection, item, files };
  }

  describe("GET /api/skills", () => {
    it("returns sorted skills and diagnostics", async () => {
      writeSkill("bravo", "B desc.");
      writeSkill("alpha", "A desc.");
      // invalid skill: name mismatch
      const badDir = join(skillsDir, "mismatch");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(
        join(badDir, "SKILL.md"),
        `---\nname: different\ndescription: nope.\n---\nbody\n`,
        "utf-8",
      );

      const { collection } = await loadRoutes();
      const res = await collection.GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.skills.map((s: { name: string }) => s.name)).toEqual([
        "alpha",
        "bravo",
      ]);
      expect(body.diagnostics).toHaveLength(1);
      expect(body.diagnostics[0].dir).toBe("mismatch");
    });

    it("returns 401 when auth fails", async () => {
      const { collection } = await loadRoutes(async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await collection.GET();
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/skills", () => {
    it("creates a skill", async () => {
      const { collection } = await loadRoutes();
      const res = await collection.POST(
        buildJsonRequest("http://localhost/api/skills", {
          name: "weekly-review",
          description: "My weekly review recipe.",
          body: "# Steps\n1. Do stuff.\n",
          tags: ["productivity"],
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const getRes = await collection.GET();
      const getBody = await getRes.json();
      expect(getBody.skills.map((s: { name: string }) => s.name)).toContain(
        "weekly-review",
      );
    });

    it("returns 409 when skill already exists", async () => {
      writeSkill("dupe");
      const { collection } = await loadRoutes();
      const res = await collection.POST(
        buildJsonRequest("http://localhost/api/skills", {
          name: "dupe",
          description: "Duplicate.",
          body: "body",
        }),
      );
      expect(res.status).toBe(409);
    });

    it("returns 400 on invalid slug", async () => {
      const { collection } = await loadRoutes();
      const res = await collection.POST(
        buildJsonRequest("http://localhost/api/skills", {
          name: "Invalid Name!",
          description: "Nope.",
          body: "body",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 413 on oversize body", async () => {
      const { collection } = await loadRoutes();
      const res = await collection.POST(
        buildJsonRequest("http://localhost/api/skills", {
          name: "big",
          description: "Big.",
          body: "x".repeat(32 * 1024 + 1),
        }),
      );
      expect(res.status).toBe(413);
    });

    it("returns 403 on untrusted origin", async () => {
      const { collection } = await loadRoutes();
      const res = await collection.POST(
        buildJsonRequest(
          "http://localhost/api/skills",
          { name: "x", description: "x", body: "x" },
          { headers: { "sec-fetch-site": "cross-site" } },
        ),
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 when auth fails", async () => {
      const { collection } = await loadRoutes(async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await collection.POST(
        buildJsonRequest("http://localhost/api/skills", {
          name: "x",
          description: "x",
          body: "x",
        }),
      );
      expect(res.status).toBe(401);
    });

    it("enforces the skills:mutate rate limit", async () => {
      vi.resetModules();
      vi.doMock("@/lib/auth-guard", () => ({ requireAuth: async () => null }));
      vi.doMock("@/lib/rate-limit-config", () => ({
        RATE_LIMITS: {
          skillsMutate: { key: "skills:mutate-test", limit: 2, windowMs: 60_000 },
        },
      }));
      const collection = await import("@/app/api/skills/route");

      for (let i = 0; i < 2; i += 1) {
        const res = await collection.POST(
          buildJsonRequest("http://localhost/api/skills", {
            name: `skill-${i}`,
            description: "d",
            body: "b",
          }),
        );
        expect(res.status).toBe(200);
      }
      const limited = await collection.POST(
        buildJsonRequest("http://localhost/api/skills", {
          name: "skill-overflow",
          description: "d",
          body: "b",
        }),
      );
      expect(limited.status).toBe(429);
    });
  });

  describe("GET /api/skills/[name]", () => {
    it("returns the full skill with supporting files metadata", async () => {
      const dir = writeSkill("research", "Research recipe.");
      writeFileSync(join(dir, "notes.md"), "extra\n", "utf-8");

      const { item } = await loadRoutes();
      const res = await item.GET(
        buildRequest("http://localhost/api/skills/research"),
        { params: Promise.resolve({ name: "research" }) },
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.name).toBe("research");
      expect(body.supporting_files).toHaveLength(1);
      expect(body.supporting_files[0].path).toBe("notes.md");
    });

    it("returns 404 on unknown skill", async () => {
      const { item } = await loadRoutes();
      const res = await item.GET(
        buildRequest("http://localhost/api/skills/missing"),
        { params: Promise.resolve({ name: "missing" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/skills/[name]", () => {
    it("updates the description", async () => {
      writeSkill("patchable", "Old desc.");
      const { item } = await loadRoutes();
      const res = await item.PATCH(
        buildJsonRequest(
          "http://localhost/api/skills/patchable",
          { description: "New description." },
          { method: "PATCH" },
        ),
        { params: Promise.resolve({ name: "patchable" }) },
      );
      expect(res.status).toBe(200);
    });

    it("returns 400 on empty patch", async () => {
      writeSkill("empty");
      const { item } = await loadRoutes();
      const res = await item.PATCH(
        buildJsonRequest("http://localhost/api/skills/empty", {}, { method: "PATCH" }),
        { params: Promise.resolve({ name: "empty" }) },
      );
      expect(res.status).toBe(400);
    });

    it("returns 413 on oversize body patch", async () => {
      writeSkill("big");
      const { item } = await loadRoutes();
      const res = await item.PATCH(
        buildJsonRequest(
          "http://localhost/api/skills/big",
          { body: "x".repeat(32 * 1024 + 1) },
          { method: "PATCH" },
        ),
        { params: Promise.resolve({ name: "big" }) },
      );
      expect(res.status).toBe(413);
    });

    it("returns 404 on unknown skill", async () => {
      const { item } = await loadRoutes();
      const res = await item.PATCH(
        buildJsonRequest(
          "http://localhost/api/skills/missing",
          { description: "x" },
          { method: "PATCH" },
        ),
        { params: Promise.resolve({ name: "missing" }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 on untrusted origin", async () => {
      writeSkill("guarded");
      const { item } = await loadRoutes();
      const res = await item.PATCH(
        buildJsonRequest(
          "http://localhost/api/skills/guarded",
          { description: "x" },
          { method: "PATCH", headers: { "sec-fetch-site": "cross-site" } },
        ),
        { params: Promise.resolve({ name: "guarded" }) },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/skills/[name]", () => {
    it("deletes a skill and returns the removed paths", async () => {
      writeSkill("goodbye");
      const { item, collection } = await loadRoutes();
      const res = await item.DELETE(
        buildJsonRequest(
          "http://localhost/api/skills/goodbye",
          {},
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ name: "goodbye" }) },
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.deleted).toContain("SKILL.md");

      const list = await collection.GET();
      const listBody = await list.json();
      expect(listBody.skills.map((s: { name: string }) => s.name)).not.toContain(
        "goodbye",
      );
    });

    it("returns 404 on unknown skill", async () => {
      const { item } = await loadRoutes();
      const res = await item.DELETE(
        buildJsonRequest("http://localhost/api/skills/missing", {}, { method: "DELETE" }),
        { params: Promise.resolve({ name: "missing" }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 on untrusted origin", async () => {
      writeSkill("guarded");
      const { item } = await loadRoutes();
      const res = await item.DELETE(
        buildJsonRequest(
          "http://localhost/api/skills/guarded",
          {},
          { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } },
        ),
        { params: Promise.resolve({ name: "guarded" }) },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/skills/[name]/files/[...path]", () => {
    it("returns the supporting file as text/plain", async () => {
      const dir = writeSkill("docs");
      mkdirSync(join(dir, "examples"), { recursive: true });
      writeFileSync(join(dir, "examples", "good.md"), "# Good\n", "utf-8");

      const { files } = await loadRoutes();
      const res = await files.GET(
        buildRequest("http://localhost/api/skills/docs/files/examples/good.md"),
        {
          params: Promise.resolve({ name: "docs", path: ["examples", "good.md"] }),
        },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toBe("# Good\n");
    });

    it("returns 404 on missing file", async () => {
      writeSkill("docs");
      const { files } = await loadRoutes();
      const res = await files.GET(
        buildRequest("http://localhost/api/skills/docs/files/nope.md"),
        { params: Promise.resolve({ name: "docs", path: ["nope.md"] }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when the parent skill is invalid", async () => {
      const dir = join(skillsDir, "broken");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        `---\nname: mismatch\ndescription: bad.\n---\nbody\n`,
        "utf-8",
      );
      writeFileSync(join(dir, "extra.md"), "leak\n", "utf-8");

      const { files } = await loadRoutes();
      const res = await files.GET(
        buildRequest("http://localhost/api/skills/broken/files/extra.md"),
        { params: Promise.resolve({ name: "broken", path: ["extra.md"] }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 on symlink", async () => {
      const dir = writeSkill("docs");
      symlinkSync("/etc/hosts", join(dir, "link.md"));
      const { files } = await loadRoutes();
      const res = await files.GET(
        buildRequest("http://localhost/api/skills/docs/files/link.md"),
        { params: Promise.resolve({ name: "docs", path: ["link.md"] }) },
      );
      expect(res.status).toBe(403);
    });

    it("returns 403 on path traversal", async () => {
      writeSkill("docs");
      const { files } = await loadRoutes();
      const res = await files.GET(
        buildRequest("http://localhost/api/skills/docs/files/..%2Fescape"),
        { params: Promise.resolve({ name: "docs", path: ["..", "escape.md"] }) },
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 when auth fails", async () => {
      writeSkill("docs");
      const { files } = await loadRoutes(async () =>
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await files.GET(
        buildRequest("http://localhost/api/skills/docs/files/anything"),
        { params: Promise.resolve({ name: "docs", path: ["anything"] }) },
      );
      expect(res.status).toBe(401);
    });
  });
});
