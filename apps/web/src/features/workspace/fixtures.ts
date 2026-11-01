export const folders = [
  { value: "D:/dev/pispark", label: "pispark" },
  { value: "D:/dev/notes", label: "notes" },
];
export const personas = [
  "Developer",
  "General",
  "Code Reviewer",
  "Architect",
].map((value) => ({ value, label: value }));
export const styles = [{ value: "Concise", label: "Concise" }];
export const models = [{ value: "balanced", label: "balanced" }];
export interface SessionSummary {
  title: string;
  folder: string;
  time: string;
  active?: boolean;
}
export const sessionGroups: { day: string; sessions: SessionSummary[] }[] = [
  {
    day: "Today",
    sessions: [
      {
        title: "Workspace review",
        folder: "D:/dev/pispark",
        time: "10:24",
        active: true,
      },
      { title: "Confirm file change", folder: "D:/dev/pispark", time: "10:12" },
      { title: "Interrupted example", folder: "D:/dev/notes", time: "09:48" },
    ],
  },
  {
    day: "Yesterday",
    sessions: [
      { title: "Release notes", folder: "D:/dev/pispark", time: "18:41" },
    ],
  },
  { day: "October 28", sessions: [] },
];
export const conversation = {
  title: "Workspace review",
  folder: "D:/dev/pispark",
  started: "Started today at 10:24",
  review: {
    duration: "1.4s",
    tokens: 6,
    thought:
      "Consolidated ask vs reply controls into a singular shared composer interface. Reading ",
    path: "src/workspace.ts",
    thoughtEnd: " to update composer prop binding.",
    tool: {
      name: "read_file",
      target: 'path: "src/workspace.ts"',
      result: "completed 12ms",
    },
    explanation:
      "The workspace stays calm by utilizing a single unified composer foundation for both prompts and follow-up reviews. Contextual pill tags handle session targeting instead of bifurcated panels.",
    tests: {
      name: "run_tests",
      summary: "4 tests passed",
      duration: "(142ms)",
    },
  },
  sidebar: {
    duration: "0.8s",
    thought: "Analyzing sidebar toggle state and keyboard shortcut binding ",
    shortcut: "Cmd/Ctrl+B",
    thoughtMiddle: ". Checking existing keyboard listeners in ",
    path: "src/sidebar.ts",
    tool: {
      name: "edit_file",
      target: "src/sidebar.ts:42",
      result: "applied 8ms",
    },
    explanation:
      "We registered a global keybinding for the sidebar toggle with standard cross-platform modifier detection:",
    mod: "Mod+B",
    mac: "⌘B",
    windows: "Ctrl+B",
    editable:
      "Ignores keystrokes when focus is currently inside editable input fields or Monaco editors.",
    collapsed:
      "Preserves collapsed width smoothly using CSS layout transition.",
  },
  first: {
    time: "10:24",
    text: "Review the workspace layout. Keep the interface quiet and consistent.",
  },
  followup: {
    time: "10:26",
    text: "Can we also inspect the file tree state and add a shortcut helper for toggling the compact session sidebar?",
  },
  diff: [
    "separateAskControls()",
    'sharedComposer({ mode: "ask" })',
    'sharedComposer({ mode: "reply" })',
  ],
};

export const sidebarCode = {
  comment: "// Register keyboard shortcut for collapsible panel",
  keyword: "export function",
  name: "registerSidebarShortcuts",
  signature: "(api: WorkspaceAPI) {",
  register: "api.shortcuts.register",
  shortcut: '"Mod+B"',
  callback: ", () => {",
  toggle: "api.sidebar.toggleCollapse",
  call: "();",
  closeCallback: "});",
  close: "}",
};
