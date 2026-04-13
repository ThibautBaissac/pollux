import { describe, expect, it } from "vitest";
import {
  parseCommand,
  COMMANDS,
  COMMAND_DEFS,
  getCommandSuggestions,
} from "@/lib/slash-commands";

describe("parseCommand", () => {
  it.each(COMMANDS)("recognizes /%s", (name) => {
    expect(parseCommand(`/${name}`)).toEqual({ name });
  });

  it("is case-insensitive", () => {
    expect(parseCommand("/NEW")).toEqual({ name: "new" });
    expect(parseCommand("/Stop")).toEqual({ name: "stop" });
    expect(parseCommand("/StAtUs")).toEqual({ name: "status" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCommand("  /dream  ")).toEqual({ name: "dream" });
    expect(parseCommand("\n/new\n")).toEqual({ name: "new" });
  });

  it("returns null for plain text", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("how are you?")).toBeNull();
  });

  it("returns null for unknown slash inputs so they pass through to the agent", () => {
    expect(parseCommand("/foo")).toBeNull();
    expect(parseCommand("/usr/local")).toBeNull();
    expect(parseCommand("what does /usr/bin do?")).toBeNull();
  });

  it("requires an exact match (no args)", () => {
    expect(parseCommand("/new something")).toBeNull();
    expect(parseCommand("/dream now")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
    expect(parseCommand("/")).toBeNull();
  });
});

describe("getCommandSuggestions", () => {
  it("returns no suggestions when text does not start with /", () => {
    expect(getCommandSuggestions("")).toEqual([]);
    expect(getCommandSuggestions("hello")).toEqual([]);
    expect(getCommandSuggestions(" /new")).toEqual([]);
  });

  it("returns all commands for a bare slash", () => {
    expect(getCommandSuggestions("/")).toEqual(COMMAND_DEFS);
  });

  it("filters by prefix", () => {
    expect(getCommandSuggestions("/d").map((c) => c.name)).toEqual(["dream"]);
    expect(getCommandSuggestions("/s").map((c) => c.name)).toEqual([
      "stop",
      "status",
      "skills",
    ]);
    expect(getCommandSuggestions("/sta").map((c) => c.name)).toEqual([
      "status",
    ]);
  });

  it("is case-insensitive", () => {
    expect(getCommandSuggestions("/D").map((c) => c.name)).toEqual(["dream"]);
  });

  it("returns no suggestions once the user types a space", () => {
    expect(getCommandSuggestions("/new something")).toEqual([]);
  });

  it("returns no suggestions for an unknown prefix", () => {
    expect(getCommandSuggestions("/xyz")).toEqual([]);
  });

  it("each command def has a non-empty description", () => {
    for (const def of COMMAND_DEFS) {
      expect(COMMANDS).toContain(def.name);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});
