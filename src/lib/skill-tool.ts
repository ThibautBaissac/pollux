import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createSkill,
  deleteSkill,
  readSkill,
  readSkillIndex,
  readSupportingFile,
  updateSkill,
} from "@/lib/skills";

export const SKILL_MCP_SERVER_NAME = "pollux-skills";
export const SKILL_MCP_TOOL_NAME = "skill";

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError && { isError }),
  };
}

function json(payload: unknown): string {
  return JSON.stringify(payload);
}

const skillToolSchema = {
  action: z.enum(["list", "view", "view_file", "create", "update", "delete"]),
  name: z.string().optional().describe("Skill name (kebab-case slug)"),
  path: z
    .string()
    .optional()
    .describe("Supporting file path for view_file (relative, no .., no absolute)"),
  description: z
    .string()
    .optional()
    .describe("Skill description for create"),
  body: z.string().optional().describe("Skill body (markdown) for create"),
  tags: z.array(z.string()).optional().describe("Optional tags for create"),
  patch: z
    .object({
      description: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional()
    .describe("Patch object for update — must include at least one field"),
};

type SkillToolArgs = z.infer<z.ZodObject<typeof skillToolSchema>>;

export async function handleSkillToolCall(args: SkillToolArgs) {
  try {
    if (args.action === "list") {
      return textResult(json({ skills: readSkillIndex() }));
    }

    if (args.action === "view") {
      if (!args.name) {
        return textResult("Error: name is required for view.", true);
      }
      const skill = readSkill(args.name);
      if (!skill) {
        return textResult(`Error: skill '${args.name}' not found.`, true);
      }
      return textResult(
        json({
          name: skill.name,
          description: skill.description,
          tags: skill.tags,
          body: skill.body,
          supporting_files: skill.supportingFiles.map((f) => ({
            path: f.path,
            size_bytes: f.sizeBytes,
          })),
        }),
      );
    }

    if (args.action === "view_file") {
      if (!args.name) {
        return textResult("Error: name is required for view_file.", true);
      }
      if (!args.path) {
        return textResult("Error: path is required for view_file.", true);
      }
      const content = readSupportingFile(args.name, args.path);
      return textResult(
        json({ name: args.name, path: args.path, content }),
      );
    }

    if (args.action === "create") {
      if (!args.name) {
        return textResult("Error: name is required for create.", true);
      }
      if (!args.description) {
        return textResult("Error: description is required for create.", true);
      }
      if (args.body === undefined) {
        return textResult("Error: body is required for create.", true);
      }
      createSkill({
        name: args.name,
        description: args.description,
        body: args.body,
        tags: args.tags,
      });
      return textResult(json({ ok: true }));
    }

    if (args.action === "update") {
      if (!args.name) {
        return textResult("Error: name is required for update.", true);
      }
      if (
        !args.patch ||
        (args.patch.description === undefined &&
          args.patch.body === undefined &&
          args.patch.tags === undefined)
      ) {
        return textResult(
          "Error: patch is required for update and must include at least one of description, body, tags.",
          true,
        );
      }
      updateSkill(args.name, args.patch);
      return textResult(json({ ok: true }));
    }

    if (args.action === "delete") {
      if (!args.name) {
        return textResult("Error: name is required for delete.", true);
      }
      const result = deleteSkill(args.name);
      return textResult(json({ ok: true, deleted: result.deleted }));
    }

    return textResult(`Error: unknown action '${args.action as string}'.`, true);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`Error: ${msg}`, true);
  }
}

const skillTool = tool(
  SKILL_MCP_TOOL_NAME,
  `Manage procedural skills — named recipes for tasks the user wants done a specific way.

Actions:
- list: Return every available skill as { name, description, tags }. Use this first when a request might match an existing skill.
- view: Load a skill's full instructions. Requires name. Returns { name, description, tags, body, supporting_files: [{ path, size_bytes }] }. Supporting-file contents are NOT inlined; fetch each with view_file.
- view_file: Load one supporting file's text content. Requires name and path (relative to the skill dir, no absolute paths, no '..'). Returns { name, path, content }. Rejects symlinks and >32KB files.
- create: Add a new skill. Requires name (kebab-case, ^[a-z][a-z0-9-]{1,47}$), description (1-200 chars, <=150 soft cap), body (<=32KB). Optional tags: string[]. Fails if name already exists.
- update: Edit an existing skill. Requires name and patch: { description?, body?, tags? } — at least one field must be provided. Unknown name fails (no upsert).
- delete: Remove a skill directory recursively. Requires name. Returns { ok, deleted: [...paths] } listing every file removed. No trash — git is the safety net.`,
  skillToolSchema,
  (args) => handleSkillToolCall(args),
);

export const skillMcpServer = createSdkMcpServer({
  name: SKILL_MCP_SERVER_NAME,
  tools: [skillTool],
});
