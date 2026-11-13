import { expect, test } from "vitest";
import { toolGroups } from "./persona-presentation";
import type { ResolvedTool } from "../../../../server/src/contract/persona-protocol";

test("tools are shown in groups: PiSpark first, then each extension, then switches nothing provides", () => {
  const tools: ResolvedTool[] = [
    { name: "read", on: true, builtIn: true, source: { kind: "core" } },
    { name: "pispark_session", on: true, builtIn: false, label: "Start other sessions", source: { kind: "core" } },
    { name: "greet", on: true, builtIn: false, source: { kind: "extension", name: "greet" } },
    { name: "lookup", on: false, builtIn: false, source: { kind: "mcp", name: "docs" } },
    { name: "gone", on: false, builtIn: false },
  ];
  expect(toolGroups(tools).map((group) => [group.title, group.tools.map((tool) => tool.name)])).toEqual([
    ["PiSpark", ["read", "pispark_session"]],
    ["greet", ["greet"]],
    ["MCP: docs", ["lookup"]],
    ["Not provided now", ["gone"]],
  ]);
});
