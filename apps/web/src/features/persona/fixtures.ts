export interface PersonaResource {
  name: string;
  icon: string;
  source: string;
  description: string;
  tag?: string;
}
export const skills: PersonaResource[] = [
  {
    name: "git-diff-checker",
    icon: "commit",
    source: "local-review-kit",
    description: "Analyzes Git working tree and staged diffs",
    tag: "git",
  },
  {
    name: "test-runner",
    icon: "play_circle",
    source: "core-std-lib",
    description: "Discovers and runs unit tests",
  },
];
export const extensions: PersonaResource[] = [
  {
    name: "monaco-diff-editor",
    icon: "extension",
    source: "core-std-lib",
    description: "Side-by-side interactive code review editor",
  },
  {
    name: "terminal-pty",
    icon: "terminal",
    source: "local-review-kit",
    description: "Background pseudo-terminal runner for subcommands",
  },
];
export interface PersonaPrompt {
  id: number;
  name: string;
  kind: "Text" | "File";
  content: string;
}
export const prompts: PersonaPrompt[] = [
  {
    id: 1,
    name: "System Persona",
    kind: "Text",
    content:
      "You are an expert developer assistant. Write precise, safe code and concise explanations. Favor idiomatic design patterns and clean error handling.",
  },
  {
    id: 2,
    name: "Project Guidelines",
    kind: "File",
    content: "./rules/coding-standards.md",
  },
];
export const commands: PersonaPrompt[] = [
  {
    id: 1,
    name: "/review",
    kind: "Text",
    content:
      "Perform a thorough code review focusing on correctness and performance.",
  },
  {
    id: 2,
    name: "/test",
    kind: "File",
    content: "./prompts/generate-tests.prompt.md",
  },
];
