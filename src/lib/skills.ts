import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from "fs";
import { isAbsolute, join, normalize, relative, sep } from "path";
import matter from "gray-matter";

export const SKILLS_DIR = join(process.cwd(), "data", "skills");

const NAME_REGEX = /^[a-z][a-z0-9-]{1,47}$/;
const DESC_MAX = 200;
const BODY_MAX = 32 * 1024;
const SUPPORTING_FILE_MAX = 32 * 1024;
const SUPPORTING_FILES_CAP = 100;

export type SkillIndexEntry = {
  name: string;
  description: string;
  tags: string[];
};

export type Skill = {
  name: string;
  description: string;
  tags: string[];
  body: string;
  supportingFiles: { path: string; sizeBytes: number }[];
};

export type SkillDiagnostic = { dir: string; reason: string };

export type CreateInput = {
  name: string;
  description: string;
  body: string;
  tags?: string[];
};

export type UpdatePatch = {
  description?: string;
  body?: string;
  tags?: string[];
};

export class SkillExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillExistsError";
  }
}

export class SkillNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillNotFoundError";
  }
}

export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillValidationError";
  }
}

export class SkillIOError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillIOError";
  }
}

function validateName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !NAME_REGEX.test(name)) {
    throw new SkillValidationError(
      `invalid skill name (must match ${NAME_REGEX})`,
    );
  }
}

function validateDescription(desc: unknown): asserts desc is string {
  if (
    typeof desc !== "string" ||
    desc.length < 1 ||
    desc.length > DESC_MAX
  ) {
    throw new SkillValidationError(
      `description must be 1-${DESC_MAX} chars`,
    );
  }
}

function validateTags(tags: unknown): asserts tags is string[] {
  if (
    !Array.isArray(tags) ||
    !tags.every((t: unknown) => typeof t === "string")
  ) {
    throw new SkillValidationError("tags must be an array of strings");
  }
}

function validateBodySize(body: string): void {
  const size = Buffer.byteLength(body, "utf-8");
  if (size > BODY_MAX) {
    throw new SkillValidationError(
      `body exceeds ${BODY_MAX} bytes (got ${size})`,
    );
  }
}

type LoadedSkill = {
  name: string;
  description: string;
  tags: string[];
  body: string;
};

type LoadResult = { ok: true; skill: LoadedSkill } | { ok: false; reason: string };

function loadSkillDir(dirname: string): LoadResult {
  const skillDir = join(SKILLS_DIR, dirname);
  const skillMd = join(skillDir, "SKILL.md");

  let st;
  try {
    st = lstatSync(skillMd);
  } catch {
    return { ok: false, reason: "missing SKILL.md" };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, reason: "SKILL.md is a symlink" };
  }
  if (!st.isFile()) {
    return { ok: false, reason: "SKILL.md is not a regular file" };
  }

  let raw: string;
  try {
    raw = readFileSync(skillMd, "utf-8");
  } catch (err) {
    return {
      ok: false,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    return {
      ok: false,
      reason: `frontmatter parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const data = parsed.data as Record<string, unknown>;
  const content = parsed.content;

  if (typeof data.name !== "string") {
    return { ok: false, reason: "missing or invalid 'name' in frontmatter" };
  }
  if (!NAME_REGEX.test(data.name)) {
    return {
      ok: false,
      reason: `name '${data.name}' does not match ${NAME_REGEX}`,
    };
  }
  if (data.name !== dirname) {
    return {
      ok: false,
      reason: `frontmatter name '${data.name}' does not match directory '${dirname}'`,
    };
  }
  if (
    typeof data.description !== "string" ||
    data.description.length < 1 ||
    data.description.length > DESC_MAX
  ) {
    return {
      ok: false,
      reason: `description must be 1-${DESC_MAX} chars`,
    };
  }

  let tags: string[] = [];
  if (data.tags !== undefined) {
    if (
      !Array.isArray(data.tags) ||
      !data.tags.every((t: unknown) => typeof t === "string")
    ) {
      return { ok: false, reason: "tags must be an array of strings" };
    }
    tags = data.tags as string[];
  }

  if (Buffer.byteLength(content, "utf-8") > BODY_MAX) {
    return {
      ok: false,
      reason: `body exceeds ${BODY_MAX} bytes`,
    };
  }

  return {
    ok: true,
    skill: {
      name: data.name,
      description: data.description,
      tags,
      body: content,
    },
  };
}

function listSkillDirs(): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(SKILLS_DIR, entry.name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (!st.isDirectory()) continue;
    result.push(entry.name);
  }
  return result.sort();
}

function collectSupportingFiles(
  skillDir: string,
): { path: string; sizeBytes: number }[] {
  const collected: { path: string; sizeBytes: number }[] = [];
  const stack: string[] = [skillDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue;
      if (current === skillDir && entry.name === "SKILL.md") continue;
      collected.push({
        path: relative(skillDir, full),
        sizeBytes: st.size,
      });
    }
  }
  collected.sort((a, b) => a.path.localeCompare(b.path));
  return collected.slice(0, SUPPORTING_FILES_CAP);
}

function walkSkills(): {
  entries: SkillIndexEntry[];
  diagnostics: SkillDiagnostic[];
} {
  const entries: SkillIndexEntry[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const dirname of listSkillDirs()) {
    const result = loadSkillDir(dirname);
    if (result.ok) {
      entries.push({
        name: result.skill.name,
        description: result.skill.description,
        tags: result.skill.tags,
      });
    } else {
      diagnostics.push({ dir: dirname, reason: result.reason });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, diagnostics };
}

export function readSkillIndex(): SkillIndexEntry[] {
  return walkSkills().entries;
}

export function readSkill(name: string): Skill | null {
  if (typeof name !== "string" || !NAME_REGEX.test(name)) return null;
  const skillDir = join(SKILLS_DIR, name);
  let st;
  try {
    st = lstatSync(skillDir);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return null;

  const result = loadSkillDir(name);
  if (!result.ok) return null;

  return {
    name: result.skill.name,
    description: result.skill.description,
    tags: result.skill.tags,
    body: result.skill.body,
    supportingFiles: collectSupportingFiles(skillDir),
  };
}

export function readSkillDiagnostics(): SkillDiagnostic[] {
  return walkSkills().diagnostics;
}

export function readSupportingFile(name: string, relPath: string): string {
  validateName(name);
  const skillDir = join(SKILLS_DIR, name);

  let dirSt;
  try {
    dirSt = lstatSync(skillDir);
  } catch {
    throw new SkillNotFoundError(`skill '${name}' not found`);
  }
  if (dirSt.isSymbolicLink() || !dirSt.isDirectory()) {
    throw new SkillNotFoundError(`skill '${name}' not found`);
  }

  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new SkillValidationError("path required");
  }
  if (isAbsolute(relPath)) {
    throw new SkillValidationError("absolute path not allowed");
  }

  const normalized = normalize(relPath);
  if (normalized === "." || normalized === "..") {
    throw new SkillValidationError("invalid path");
  }
  const segments = normalized.split(sep).filter((s) => s.length > 0);
  if (segments.some((s) => s === "..")) {
    throw new SkillValidationError("path traversal not allowed");
  }
  if (segments.length === 0) {
    throw new SkillValidationError("path required");
  }
  if (segments.length === 1 && segments[0] === "SKILL.md") {
    throw new SkillValidationError(
      "SKILL.md is loaded via readSkill, not readSupportingFile",
    );
  }

  let cursor = skillDir;
  let finalSt = lstatSync(skillDir);
  for (const seg of segments) {
    cursor = join(cursor, seg);
    try {
      finalSt = lstatSync(cursor);
    } catch {
      throw new SkillNotFoundError(`file not found: ${relPath}`);
    }
    if (finalSt.isSymbolicLink()) {
      throw new SkillValidationError("symlinks not allowed");
    }
  }

  if (!finalSt.isFile()) {
    throw new SkillValidationError("not a regular file");
  }
  if (finalSt.size > SUPPORTING_FILE_MAX) {
    throw new SkillValidationError(
      `file exceeds ${SUPPORTING_FILE_MAX} bytes`,
    );
  }
  const content = readFileSync(cursor, "utf-8");
  if (content.includes("\u0000")) {
    throw new SkillValidationError("binary content not supported");
  }
  return content;
}

export function createSkill(input: CreateInput): void {
  validateName(input.name);
  validateDescription(input.description);
  if (input.tags !== undefined) validateTags(input.tags);
  if (typeof input.body !== "string") {
    throw new SkillValidationError("body must be a string");
  }
  validateBodySize(input.body);

  const dir = join(SKILLS_DIR, input.name);
  if (existsSync(dir)) {
    throw new SkillExistsError(`skill '${input.name}' already exists`);
  }
  mkdirSync(dir, { recursive: true });

  const frontmatter: Record<string, unknown> = {
    name: input.name,
    description: input.description,
  };
  if (input.tags && input.tags.length > 0) frontmatter.tags = input.tags;

  const serialized = matter.stringify(input.body, frontmatter);
  writeFileSync(join(dir, "SKILL.md"), serialized, "utf-8");
}

export function updateSkill(name: string, patch: UpdatePatch): void {
  validateName(name);
  if (
    patch.description === undefined &&
    patch.body === undefined &&
    patch.tags === undefined
  ) {
    throw new SkillValidationError(
      "patch must include at least one of description, body, tags",
    );
  }
  if (patch.description !== undefined) validateDescription(patch.description);
  if (patch.tags !== undefined) validateTags(patch.tags);
  if (patch.body !== undefined) {
    if (typeof patch.body !== "string") {
      throw new SkillValidationError("body must be a string");
    }
    validateBodySize(patch.body);
  }

  const dir = join(SKILLS_DIR, name);
  const skillMd = join(dir, "SKILL.md");

  let dirSt;
  try {
    dirSt = lstatSync(dir);
  } catch {
    throw new SkillNotFoundError(`skill '${name}' not found`);
  }
  if (dirSt.isSymbolicLink() || !dirSt.isDirectory()) {
    throw new SkillNotFoundError(`skill '${name}' is not a valid skill directory`);
  }

  let mdSt;
  try {
    mdSt = lstatSync(skillMd);
  } catch {
    throw new SkillNotFoundError(`skill '${name}' has no SKILL.md`);
  }
  if (mdSt.isSymbolicLink() || !mdSt.isFile()) {
    throw new SkillValidationError(
      `skill '${name}' SKILL.md is not a regular file`,
    );
  }

  const raw = readFileSync(skillMd, "utf-8");
  const parsed = matter(raw);
  const merged: Record<string, unknown> = { ...parsed.data };

  merged.name = name;
  if (patch.description !== undefined) merged.description = patch.description;
  if (patch.tags !== undefined) {
    if (patch.tags.length > 0) merged.tags = patch.tags;
    else delete merged.tags;
  }

  const newBody = patch.body !== undefined ? patch.body : parsed.content;
  const serialized = matter.stringify(newBody, merged);
  writeFileSync(skillMd, serialized, "utf-8");
}

export function deleteSkill(name: string): { deleted: string[] } {
  validateName(name);
  const dir = join(SKILLS_DIR, name);

  let st;
  try {
    st = lstatSync(dir);
  } catch {
    throw new SkillNotFoundError(`skill '${name}' not found`);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new SkillNotFoundError(`skill '${name}' is not a valid skill directory`);
  }

  const files: string[] = [];
  const dirs: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      let est;
      try {
        est = lstatSync(full);
      } catch {
        continue;
      }
      if (est.isDirectory() && !est.isSymbolicLink()) {
        stack.push(full);
        dirs.push(full);
      } else {
        files.push(full);
      }
    }
  }

  const deleted: string[] = [];
  const remaining: string[] = [];
  for (const f of files) {
    try {
      unlinkSync(f);
      deleted.push(relative(dir, f));
    } catch {
      remaining.push(relative(dir, f));
    }
  }

  if (remaining.length > 0) {
    deleted.sort();
    remaining.sort();
    throw new SkillIOError(
      `partial delete: ${JSON.stringify({ deleted, remaining })}`,
    );
  }

  dirs.sort((a, b) => b.length - a.length);
  const remainingDirs: string[] = [];
  for (const d of dirs) {
    try {
      rmdirSync(d);
    } catch {
      remainingDirs.push(relative(dir, d));
    }
  }
  let topFailed = false;
  try {
    rmdirSync(dir);
  } catch {
    topFailed = true;
  }

  if (topFailed || remainingDirs.length > 0) {
    deleted.sort();
    const remaining = [...remainingDirs];
    if (topFailed) remaining.push(".");
    remaining.sort();
    throw new SkillIOError(
      `skill directory not fully removed: ${JSON.stringify({ deleted, remaining })}`,
    );
  }

  deleted.sort();
  return { deleted };
}
