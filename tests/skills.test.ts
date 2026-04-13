import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("skills", () => {
  let rootDir = "";
  let skillsDir = "";

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "pollux-skills-"));
    skillsDir = join(rootDir, "data", "skills");
    mkdirSync(skillsDir, { recursive: true });
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(rootDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      /* empty */
    }
  });

  async function loadSkills() {
    vi.resetModules();
    return import("@/lib/skills");
  }

  function writeSkillFile(name: string, raw: string) {
    const dir = join(skillsDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), raw, "utf-8");
  }

  function validFrontmatter(name: string, description = "Test skill.") {
    return `---\nname: ${name}\ndescription: ${description}\n---\n\nBody here.\n`;
  }

  describe("readSkillIndex / diagnostics", () => {
    it("returns sorted entries and excludes invalid skills", async () => {
      const { readSkillIndex, readSkillDiagnostics } = await loadSkills();

      writeSkillFile("bravo", validFrontmatter("bravo", "Bravo description."));
      writeSkillFile("alpha", validFrontmatter("alpha", "Alpha description."));
      writeSkillFile(
        "mismatch",
        `---\nname: different\ndescription: nope.\n---\nbody\n`,
      );
      writeSkillFile(
        "broken",
        `---\nname: [not-a-string]\ndescription: x\n---\nbody\n`,
      );

      const index = readSkillIndex();
      expect(index.map((e) => e.name)).toEqual(["alpha", "bravo"]);

      const diags = readSkillDiagnostics();
      const dirs = diags.map((d) => d.dir).sort();
      expect(dirs).toEqual(["broken", "mismatch"]);
      expect(diags.find((d) => d.dir === "mismatch")?.reason).toMatch(
        /does not match directory/,
      );
    });

    it("reports body-oversize in diagnostics", async () => {
      const { readSkillDiagnostics } = await loadSkills();
      const big = "x".repeat(33 * 1024);
      writeSkillFile(
        "hefty",
        `---\nname: hefty\ndescription: too big.\n---\n${big}\n`,
      );
      const diags = readSkillDiagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0]).toMatchObject({ dir: "hefty" });
      expect(diags[0].reason).toMatch(/body exceeds/);
    });

    it("reports symlinked SKILL.md in diagnostics", async () => {
      const { readSkillDiagnostics } = await loadSkills();
      const target = join(rootDir, "target.md");
      writeFileSync(
        target,
        `---\nname: linked\ndescription: symlinked.\n---\nbody\n`,
      );
      const dir = join(skillsDir, "linked");
      mkdirSync(dir);
      symlinkSync(target, join(dir, "SKILL.md"));

      const diags = readSkillDiagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0]).toMatchObject({ dir: "linked" });
      expect(diags[0].reason).toMatch(/symlink/);
    });

    it("returns empty index when skills dir is missing", async () => {
      const { readSkillIndex, readSkillDiagnostics } = await loadSkills();
      rmSync(skillsDir, { recursive: true, force: true });
      expect(readSkillIndex()).toEqual([]);
      expect(readSkillDiagnostics()).toEqual([]);
    });
  });

  describe("readSkill", () => {
    it("returns null for missing skill", async () => {
      const { readSkill } = await loadSkills();
      expect(readSkill("does-not-exist")).toBeNull();
    });

    it("returns null for invalid skill-name format", async () => {
      const { readSkill } = await loadSkills();
      expect(readSkill("Invalid Name")).toBeNull();
    });

    it("returns parsed skill with tags and body", async () => {
      const { readSkill } = await loadSkills();
      writeSkillFile(
        "demo",
        `---\nname: demo\ndescription: demo skill.\ntags:\n  - a\n  - b\n---\n\nHello.\n`,
      );
      const skill = readSkill("demo");
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("demo");
      expect(skill!.tags).toEqual(["a", "b"]);
      expect(skill!.body).toContain("Hello.");
    });

    it("lists supporting files as path-sorted metadata, caps at 100, omits symlinks", async () => {
      const { readSkill } = await loadSkills();
      writeSkillFile("big", validFrontmatter("big"));
      const dir = join(skillsDir, "big");
      const supportDir = join(dir, "examples");
      mkdirSync(supportDir);
      for (let i = 0; i < 105; i += 1) {
        const padded = String(i).padStart(3, "0");
        writeFileSync(join(supportDir, `file-${padded}.md`), `content ${i}`);
      }
      // add a symlink that should be skipped
      symlinkSync(
        join(supportDir, "file-000.md"),
        join(supportDir, "link.md"),
      );

      const skill = readSkill("big")!;
      expect(skill.supportingFiles).toHaveLength(100);
      // Path-sorted → examples/file-000 through file-099 (drop file-100..104 after slice)
      expect(skill.supportingFiles[0].path).toBe(
        join("examples", "file-000.md"),
      );
      expect(skill.supportingFiles[99].path).toBe(
        join("examples", "file-099.md"),
      );
      expect(
        skill.supportingFiles.some((f) => f.path.endsWith("link.md")),
      ).toBe(false);
      expect(skill.supportingFiles[0].sizeBytes).toBeGreaterThan(0);
    });
  });

  describe("readSupportingFile", () => {
    beforeEach(() => {
      // ensure a skill dir with some supporting files exists for each test
      mkdirSync(join(skillsDir, "demo"), { recursive: true });
      writeFileSync(
        join(skillsDir, "demo", "SKILL.md"),
        validFrontmatter("demo"),
        "utf-8",
      );
      mkdirSync(join(skillsDir, "demo", "examples"));
      writeFileSync(
        join(skillsDir, "demo", "examples", "ex1.md"),
        "example one",
        "utf-8",
      );
    });

    it("reads a supporting file", async () => {
      const { readSupportingFile } = await loadSkills();
      expect(readSupportingFile("demo", "examples/ex1.md")).toBe(
        "example one",
      );
    });

    it("rejects missing files", async () => {
      const { readSupportingFile } = await loadSkills();
      expect(() => readSupportingFile("demo", "missing.md")).toThrow(
        /file not found/,
      );
    });

    it("rejects oversize files", async () => {
      const { readSupportingFile } = await loadSkills();
      const big = "x".repeat(33 * 1024);
      writeFileSync(join(skillsDir, "demo", "big.md"), big, "utf-8");
      expect(() => readSupportingFile("demo", "big.md")).toThrow(
        /exceeds/,
      );
    });

    it("rejects symlinks", async () => {
      const { readSupportingFile } = await loadSkills();
      const target = join(rootDir, "outside.md");
      writeFileSync(target, "leak", "utf-8");
      symlinkSync(target, join(skillsDir, "demo", "link.md"));
      expect(() => readSupportingFile("demo", "link.md")).toThrow(
        /symlink/,
      );
    });

    it("rejects absolute paths", async () => {
      const { readSupportingFile } = await loadSkills();
      expect(() =>
        readSupportingFile("demo", "/etc/passwd"),
      ).toThrow(/absolute path/);
    });

    it("rejects path traversal", async () => {
      const { readSupportingFile } = await loadSkills();
      expect(() => readSupportingFile("demo", "../../etc/passwd")).toThrow(
        /traversal/,
      );
    });

    it("rejects SKILL.md", async () => {
      const { readSupportingFile } = await loadSkills();
      expect(() => readSupportingFile("demo", "SKILL.md")).toThrow(
        /readSkill/,
      );
    });

    it("rejects binary (NUL-byte) content", async () => {
      const { readSupportingFile } = await loadSkills();
      writeFileSync(
        join(skillsDir, "demo", "bin.dat"),
        Buffer.from([0x41, 0x00, 0x42]),
      );
      expect(() => readSupportingFile("demo", "bin.dat")).toThrow(
        /binary/,
      );
    });

    it("throws for missing skill", async () => {
      const { readSupportingFile } = await loadSkills();
      expect(() => readSupportingFile("nope", "file.md")).toThrow(
        /not found/,
      );
    });
  });

  describe("createSkill", () => {
    it("writes frontmatter and body, round-trips through readSkill", async () => {
      const { createSkill, readSkill } = await loadSkills();
      createSkill({
        name: "new-skill",
        description: "A freshly created skill.",
        body: "# Hello\n\nSteps go here.",
        tags: ["x", "y"],
      });

      const skill = readSkill("new-skill");
      expect(skill).not.toBeNull();
      expect(skill!.description).toBe("A freshly created skill.");
      expect(skill!.tags).toEqual(["x", "y"]);
      expect(skill!.body.trim()).toBe("# Hello\n\nSteps go here.");

      const onDisk = readFileSync(
        join(skillsDir, "new-skill", "SKILL.md"),
        "utf-8",
      );
      expect(onDisk).toMatch(/^---\n/);
      expect(onDisk).toContain("name: new-skill");
    });

    it("throws on name collision", async () => {
      const { createSkill, SkillExistsError } = await loadSkills();
      createSkill({ name: "dup", description: "one", body: "a" });
      expect(() =>
        createSkill({ name: "dup", description: "two", body: "b" }),
      ).toThrow(SkillExistsError);
    });

    it("rejects invalid name", async () => {
      const { createSkill, SkillValidationError } = await loadSkills();
      expect(() =>
        createSkill({ name: "BadName", description: "x", body: "y" }),
      ).toThrow(SkillValidationError);
    });

    it("rejects oversize description", async () => {
      const { createSkill, SkillValidationError } = await loadSkills();
      expect(() =>
        createSkill({
          name: "ok",
          description: "x".repeat(201),
          body: "y",
        }),
      ).toThrow(SkillValidationError);
    });

    it("rejects oversize body", async () => {
      const { createSkill, SkillValidationError } = await loadSkills();
      expect(() =>
        createSkill({
          name: "ok",
          description: "d",
          body: "x".repeat(33 * 1024),
        }),
      ).toThrow(SkillValidationError);
    });
  });

  describe("updateSkill", () => {
    it("throws when skill is missing", async () => {
      const { updateSkill, SkillNotFoundError } = await loadSkills();
      expect(() =>
        updateSkill("missing", { description: "nope" }),
      ).toThrow(SkillNotFoundError);
    });

    it("rejects empty patch", async () => {
      const { createSkill, updateSkill, SkillValidationError } =
        await loadSkills();
      createSkill({ name: "empty", description: "d", body: "b" });
      expect(() => updateSkill("empty", {})).toThrow(SkillValidationError);
    });

    it("updates description while preserving body and tags", async () => {
      const { createSkill, updateSkill, readSkill } = await loadSkills();
      createSkill({
        name: "partial",
        description: "old desc",
        body: "keep me",
        tags: ["keep"],
      });
      updateSkill("partial", { description: "new desc" });
      const skill = readSkill("partial")!;
      expect(skill.description).toBe("new desc");
      expect(skill.body.trim()).toBe("keep me");
      expect(skill.tags).toEqual(["keep"]);
    });

    it("updates body only", async () => {
      const { createSkill, updateSkill, readSkill } = await loadSkills();
      createSkill({ name: "body-only", description: "d", body: "old" });
      updateSkill("body-only", { body: "new body" });
      expect(readSkill("body-only")!.body.trim()).toBe("new body");
    });

    it("clears tags when patched with empty array", async () => {
      const { createSkill, updateSkill, readSkill } = await loadSkills();
      createSkill({
        name: "tag-clear",
        description: "d",
        body: "b",
        tags: ["a", "b"],
      });
      updateSkill("tag-clear", { tags: [] });
      expect(readSkill("tag-clear")!.tags).toEqual([]);
    });

    it("enforces size caps", async () => {
      const { createSkill, updateSkill, SkillValidationError } =
        await loadSkills();
      createSkill({ name: "cap", description: "d", body: "b" });
      expect(() =>
        updateSkill("cap", { body: "x".repeat(33 * 1024) }),
      ).toThrow(SkillValidationError);
      expect(() =>
        updateSkill("cap", { description: "y".repeat(201) }),
      ).toThrow(SkillValidationError);
    });

    it("rejects when SKILL.md is a symlink", async () => {
      const { updateSkill, SkillValidationError } = await loadSkills();
      const target = join(rootDir, "outside.md");
      writeFileSync(
        target,
        `---\nname: symlinked\ndescription: external target.\n---\nbody\n`,
        "utf-8",
      );
      const dir = join(skillsDir, "symlinked");
      mkdirSync(dir);
      symlinkSync(target, join(dir, "SKILL.md"));

      expect(() =>
        updateSkill("symlinked", { description: "new" }),
      ).toThrow(SkillValidationError);

      // target must be untouched
      expect(readFileSync(target, "utf-8")).toContain("external target.");
    });

    it("rejects when skill directory itself is a symlink", async () => {
      const { updateSkill, SkillNotFoundError } = await loadSkills();
      const target = join(rootDir, "external");
      mkdirSync(target);
      writeFileSync(
        join(target, "SKILL.md"),
        `---\nname: linked-dir\ndescription: d.\n---\nbody\n`,
        "utf-8",
      );
      symlinkSync(target, join(skillsDir, "linked-dir"));

      expect(() =>
        updateSkill("linked-dir", { description: "new" }),
      ).toThrow(SkillNotFoundError);
    });
  });

  describe("deleteSkill", () => {
    it("removes skill dir recursively and returns deleted paths", async () => {
      const { createSkill, deleteSkill } = await loadSkills();
      createSkill({ name: "gone", description: "d", body: "b" });
      const dir = join(skillsDir, "gone");
      mkdirSync(join(dir, "examples"), { recursive: true });
      writeFileSync(join(dir, "examples", "a.md"), "a");
      writeFileSync(join(dir, "README.md"), "readme");

      const result = deleteSkill("gone");
      expect(existsSync(dir)).toBe(false);
      expect(result.deleted.sort()).toEqual(
        ["README.md", "SKILL.md", join("examples", "a.md")].sort(),
      );
    });

    it("throws SkillNotFoundError on missing skill", async () => {
      const { deleteSkill, SkillNotFoundError } = await loadSkills();
      expect(() => deleteSkill("ghost")).toThrow(SkillNotFoundError);
    });

    it("surfaces partial-delete state when a file cannot be removed", async () => {
      const { createSkill, deleteSkill, SkillIOError } = await loadSkills();
      createSkill({ name: "stuck", description: "d", body: "b" });
      const dir = join(skillsDir, "stuck");
      const locked = join(dir, "sub");
      mkdirSync(locked);
      writeFileSync(join(locked, "pinned.md"), "nope");

      // On POSIX, clearing write on the parent directory makes unlink fail
      // with EACCES for non-root users. Skip if that doesn't hold (e.g., root).
      chmodSync(locked, 0o500);
      let thrown: unknown;
      try {
        deleteSkill("stuck");
      } catch (err) {
        thrown = err;
      } finally {
        chmodSync(locked, 0o700);
      }

      if (process.getuid && process.getuid() === 0) {
        // running as root — unlink won't fail; nothing to assert
        return;
      }

      expect(thrown).toBeInstanceOf(SkillIOError);
      const msg = (thrown as Error).message;
      expect(msg).toMatch(/partial delete/);
      expect(msg).toContain("pinned.md");
      expect(existsSync(dir)).toBe(true);
    });

    it("throws when the skill directory itself cannot be removed", async () => {
      const { createSkill, deleteSkill, SkillIOError } = await loadSkills();
      createSkill({ name: "pinned", description: "d", body: "b" });
      const dir = join(skillsDir, "pinned");

      // Lock SKILLS_DIR so rmdir(skillDir) fails, while leaving skillDir
      // itself writable so inner unlinks succeed.
      chmodSync(skillsDir, 0o500);
      let thrown: unknown;
      try {
        deleteSkill("pinned");
      } catch (err) {
        thrown = err;
      } finally {
        chmodSync(skillsDir, 0o700);
      }

      if (process.getuid && process.getuid() === 0) return;

      expect(thrown).toBeInstanceOf(SkillIOError);
      const msg = (thrown as Error).message;
      expect(msg).toMatch(/not fully removed/);
      expect(existsSync(dir)).toBe(true);
    });
  });
});

describe("skill-tool MCP handler", () => {
  let rootDir = "";
  let skillsDir = "";

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "pollux-skill-tool-"));
    skillsDir = join(rootDir, "data", "skills");
    mkdirSync(skillsDir, { recursive: true });
    vi.restoreAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue(rootDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      /* empty */
    }
  });

  async function load() {
    vi.resetModules();
    return import("@/lib/skill-tool");
  }

  function extractText(result: { content: { type: string; text: string }[] }) {
    return result.content[0].text;
  }

  it("list returns JSON with empty skills array when none exist", async () => {
    const { handleSkillToolCall } = await load();
    const res = await handleSkillToolCall({ action: "list" });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(extractText(res))).toEqual({ skills: [] });
  });

  it("create → list → view round-trip", async () => {
    const { handleSkillToolCall } = await load();

    const create = await handleSkillToolCall({
      action: "create",
      name: "rt",
      description: "round-trip skill",
      body: "hello",
      tags: ["t"],
    });
    expect(create.isError).toBeUndefined();
    expect(JSON.parse(extractText(create))).toEqual({ ok: true });

    const list = await handleSkillToolCall({ action: "list" });
    expect(JSON.parse(extractText(list))).toEqual({
      skills: [{ name: "rt", description: "round-trip skill", tags: ["t"] }],
    });

    const view = await handleSkillToolCall({ action: "view", name: "rt" });
    const parsed = JSON.parse(extractText(view));
    expect(parsed).toMatchObject({
      name: "rt",
      description: "round-trip skill",
      tags: ["t"],
      supporting_files: [],
    });
    expect(parsed.body).toContain("hello");
  });

  it("update rejects empty patch", async () => {
    const { handleSkillToolCall } = await load();
    await handleSkillToolCall({
      action: "create",
      name: "up-skill",
      description: "d",
      body: "b",
    });
    const res = await handleSkillToolCall({
      action: "update",
      name: "up-skill",
      patch: {},
    });
    expect(res.isError).toBe(true);
    expect(extractText(res)).toMatch(/at least one of/);
  });

  it("update applies patch", async () => {
    const { handleSkillToolCall } = await load();
    await handleSkillToolCall({
      action: "create",
      name: "up-skill-2",
      description: "old",
      body: "b",
    });
    const res = await handleSkillToolCall({
      action: "update",
      name: "up-skill-2",
      patch: { description: "new" },
    });
    expect(res.isError).toBeUndefined();

    const view = await handleSkillToolCall({
      action: "view",
      name: "up-skill-2",
    });
    expect(JSON.parse(extractText(view)).description).toBe("new");
  });

  it("delete returns the deleted path list", async () => {
    const { handleSkillToolCall } = await load();
    await handleSkillToolCall({
      action: "create",
      name: "to-delete",
      description: "d",
      body: "b",
    });
    const res = await handleSkillToolCall({
      action: "delete",
      name: "to-delete",
    });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(extractText(res))).toEqual({
      ok: true,
      deleted: ["SKILL.md"],
    });
  });

  it("view_file rejects absolute path", async () => {
    const { handleSkillToolCall } = await load();
    await handleSkillToolCall({
      action: "create",
      name: "vf",
      description: "d",
      body: "b",
    });
    const res = await handleSkillToolCall({
      action: "view_file",
      name: "vf",
      path: "/etc/passwd",
    });
    expect(res.isError).toBe(true);
    expect(extractText(res)).toMatch(/absolute/);
  });

  it("view_file rejects traversal", async () => {
    const { handleSkillToolCall } = await load();
    await handleSkillToolCall({
      action: "create",
      name: "vf2",
      description: "d",
      body: "b",
    });
    const res = await handleSkillToolCall({
      action: "view_file",
      name: "vf2",
      path: "../../etc/passwd",
    });
    expect(res.isError).toBe(true);
    expect(extractText(res)).toMatch(/traversal/);
  });

  it("view_file rejects symlinks", async () => {
    const { handleSkillToolCall } = await load();
    await handleSkillToolCall({
      action: "create",
      name: "vf3",
      description: "d",
      body: "b",
    });
    const target = join(rootDir, "outside.md");
    writeFileSync(target, "secret", "utf-8");
    symlinkSync(target, join(skillsDir, "vf3", "link.md"));
    const res = await handleSkillToolCall({
      action: "view_file",
      name: "vf3",
      path: "link.md",
    });
    expect(res.isError).toBe(true);
    expect(extractText(res)).toMatch(/symlink/);
  });

  it("view on unknown skill returns isError", async () => {
    const { handleSkillToolCall } = await load();
    const res = await handleSkillToolCall({ action: "view", name: "ghost" });
    expect(res.isError).toBe(true);
    expect(extractText(res)).toMatch(/not found/);
  });

  it("create collision surfaces as isError", async () => {
    const { handleSkillToolCall } = await load();
    await handleSkillToolCall({
      action: "create",
      name: "collide",
      description: "d",
      body: "b",
    });
    const res = await handleSkillToolCall({
      action: "create",
      name: "collide",
      description: "d",
      body: "b",
    });
    expect(res.isError).toBe(true);
    expect(extractText(res)).toMatch(/already exists/);
  });
});
