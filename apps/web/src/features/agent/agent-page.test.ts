import { describe, expect, it } from "vitest";
import type { AgentSummary, AgentView, ResolvedItem } from "../../../../server/src/contract/agent-protocol";
import type { AgentClient } from "./agent-client.svelte";
import { AgentPage, keyOf } from "./agent-page.svelte";
import { argumentNames, fieldOf, withField } from "./frontmatter";

const item = (over: Partial<ResolvedItem> & Pick<ResolvedItem, "type" | "name">): ResolvedItem => ({
  on: true,
  origin: { id: "shop", name: "Shop" },
  replaced: [],
  ...over,
});

function pageWith(items: ResolvedItem[], summary: Partial<AgentSummary> = {}, instructions?: string[]) {
  const view = {
    target: { agent: "shop" },
    definition: { name: "Shop", resources: instructions ? { instructions } : {} },
    revision: "r",
    layers: [],
    items,
    tools: [],
    settings: {},
  } as unknown as AgentView;
  const client = { view, items: [{ id: "shop", name: "Shop", base: [], builtIn: false, valid: true, ...summary }] } as unknown as AgentClient;
  return new AgentPage(client, "shop");
}

describe("agent page rules", () => {
  const own = item({ type: "skills", name: "deploy", reference: "local:deploy", path: "skills/deploy/SKILL.md" });
  const shared = item({ type: "skills", name: "review", reference: "shared:review", usedBy: 3 });
  const lone = item({ type: "skills", name: "notes", reference: "shared:notes", usedBy: 1 });
  const bundled = item({ type: "skills", name: "pdf", reference: "bundled:pdf" });
  const inherited = item({ type: "skills", name: "style", reference: "local:style", origin: { id: "default", name: "Default" } });

  it("says where each item comes from, and what can be changed here", () => {
    const page = pageWith([own, shared, lone, bundled, inherited]);
    expect([own, shared, lone, bundled, inherited].map((i) => page.source(i))).toEqual(["Only this agent", "Shared · 3 agents", "Shared", "Bundled", "From Default"]);
    expect([own, shared, lone, bundled, inherited].map((i) => page.editable(i))).toEqual([true, true, true, false, false]);
    expect([own, shared, bundled, inherited].map((i) => page.owns(i))).toEqual([true, false, false, false]);
    expect([own, shared, lone].map((i) => page.reach(i))).toEqual([undefined, 3, undefined]);
    expect([own, shared, bundled, inherited].map((i) => page.removable(i))).toEqual(["delete", "remove", "remove", undefined]);
  });

  it("a bundled agent can be read, not changed", () => {
    const page = pageWith([own], { bundled: true });
    expect([page.readOnly, page.editable(own), page.owns(own), page.removable(own), page.source(own)]).toEqual([true, false, false, undefined, "Bundled"]);
  });

  it("instructions list what's read first, then what's off; something new joins the read ones", () => {
    const a = item({ type: "instructions", name: "a", reference: "local:a" });
    const off = item({ type: "instructions", name: "off", reference: "local:off", on: false });
    const b = item({ type: "instructions", name: "b", reference: "local:b" });
    const page = pageWith([a, off, b], {}, ["local:a", "local:off", "local:b"]);
    page.create("instructions");
    expect(page.rows("instructions").map(keyOf)).toEqual(["instructions/a", "instructions/b", "instructions/new", "instructions/off"]);
    expect(page.opened("instructions", false) && keyOf(page.opened("instructions", false)!)).toBe("instructions/new");
    // Only its own, by its own list.
    expect([page.movable(a, -1), page.movable(a, 1), page.movable(b, 1)]).toEqual([false, true, false]);
    expect(page.movable(item({ type: "instructions", name: "x", origin: { id: "default", name: "Default" } }), 1)).toBe(false);
  });

  it("opens the first item where there's room, nothing on a phone, and extensions only when picked", () => {
    const page = pageWith([own, shared, item({ type: "extensions", name: "telegram", reference: "shared:telegram" })]);
    expect(keyOf(page.opened("skills", false)!)).toBe("skills/deploy");
    expect(page.opened("skills", true)).toBeUndefined();
    expect(page.opened("extensions", false)).toBeUndefined();
    page.show("skills", shared);
    expect(keyOf(page.opened("skills", true)!)).toBe("skills/review");
  });

  it("a new item is unsaved until named and saved; discarding drops it", () => {
    const page = pageWith([]);
    const fresh = page.create("skills");
    expect(page.dirty(fresh)).toBe(true);
    page.rename(fresh, "refunds");
    expect(fieldOf(page.fresh.skills!.draft, "name")).toBe("refunds");
    page.discard(page.fresh.skills!);
    expect(page.fresh.skills).toBeUndefined();
    expect(page.open.skills).toBeUndefined();
  });
});

describe("agent page and Agent Builder", () => {
  const own = item({ type: "skills", name: "deploy", reference: "local:deploy", path: "skills/deploy/SKILL.md" });
  const shared = item({ type: "skills", name: "review", reference: "shared:review", path: "skills/review/SKILL.md", usedBy: 3 });
  const inherited = item({ type: "instructions", name: "style", reference: "local:style", path: "instructions/style.md", origin: { id: "writer", name: "Writer" } });

  it("one ⋯ menu for every tab: the tab's own entries, then own, shared or remove", () => {
    const page = pageWith([own, shared, inherited]);
    const labels = (row: ResolvedItem) => page.entries(row, [{ id: "x", label: "Extra", onselect: () => {} }]).map((e) => e.label);
    expect(labels(own)).toEqual(["Extra", "Move to Shared library", "Delete skill"]);
    expect(labels(shared)).toEqual(["Extra", "Make it this agent's own", "Remove from this agent"]);
    expect(labels(inherited)).toEqual(["Extra", "Make it this agent's own"]);
    expect(pageWith([own], { bundled: true }).entries(own)).toEqual([]);
  });

  it("Agent Builder works on saved files: unsaved text holds sending", () => {
    const page = pageWith([own]);
    page.texts[keyOf(own)] = { saved: "a", draft: "a", revision: "r", loading: false, error: "" };
    expect(page.unsaved(own)).toBeUndefined();
    page.setDraft(own, "b");
    expect(page.unsaved(own)).toMatch(/Save or discard your changes to deploy/);
    const fresh = page.create("skills");
    expect(page.unsaved(fresh)).toBeUndefined();
    page.setDraft(page.fresh.skills!, page.fresh.skills!.draft + "Steps.");
    expect(page.unsaved(page.fresh.skills!)).toMatch(/Save or discard the new one/);
  });

  it("the note says what's open and where its file is, seen from the agent's folder", () => {
    const page = pageWith([own, shared, inherited]);
    expect(page.note("skills", shared)).toMatch(/Open: the skill "review" \(Shared · 3 agents\), file \.\.\/\.\.\/resources\/skills\/review\/SKILL\.md\. It's shared: 3 agents use it/);
    expect(page.note("instructions", inherited)).toMatch(/file \.\.\/writer\/instructions\/style\.md/);
    expect(page.note("skills", undefined)).toMatch(/Nothing is open: something new goes in Skills/);
    expect(page.note("skills", own)).toMatch(/Its items\. Instructions: style \(From Writer\)\. Skills: deploy \(Only this agent\), review/);
  });
});

describe("front matter fields", () => {
  const skill = "---\r\nname: review\r\ndescription: >\r\n  Review code.\r\n  Use for PRs.\r\nlicense: MIT\r\n---\r\n# Review\r\n";

  it("reads plain and folded values", () => {
    expect(fieldOf(skill, "name")).toBe("review");
    expect(fieldOf(skill, "description")).toBe("Review code. Use for PRs.");
    expect(fieldOf("# No front matter", "name")).toBe("");
    expect(fieldOf('---\nargument-hint: "<version> [since]"\n---\n', "argument-hint")).toBe("<version> [since]");
  });

  it("sets one field and leaves the rest of the file as written", () => {
    expect(withField(skill, "description", "Review a change: bugs first.")).toBe(
      '---\r\nname: review\r\ndescription: "Review a change: bugs first."\r\nlicense: MIT\r\n---\r\n# Review\r\n',
    );
    expect(withField("---\nname: x\n---\nBody\n", "description", "Plain words")).toBe("---\nname: x\ndescription: Plain words\n---\nBody\n");
    expect(withField("Body only\n", "description", "New")).toBe("---\ndescription: New\n---\n\nBody only\n");
  });

  it("names a prompt's arguments from its hint", () => {
    expect(argumentNames("<version> [since tag]")).toEqual(["version", "since tag"]);
    expect(argumentNames("")).toEqual([]);
  });
});
