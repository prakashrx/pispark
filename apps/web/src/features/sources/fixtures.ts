export interface Source {
  id: string;
  name: string;
  kind: "Local Git" | "Marketplace" | "Git Repository";
  location: string;
  detail: string;
  resources: string[];
  updated: string;
  status: "Active" | "Disabled" | "Draft";
  official?: boolean;
  branch?: string;
}
export interface SourceDraft {
  name: string;
  kind: "git" | "registry";
  location: string;
  branch: string;
  autoUpdate: boolean;
}
export const sources: Source[] = [
  {
    id: "local-review-kit",
    name: "local-review-kit",
    kind: "Local Git",
    location: "file://./kits/review-kit",
    detail: "rev a1b2c3",
    resources: ["2 skills", "1 prompt", "1 extension"],
    updated: "Updated 22m ago",
    status: "Active",
  },
  {
    id: "pispark-official-registry",
    name: "pispark-official-registry",
    kind: "Marketplace",
    location: "https://registry.pispark.dev/v1",
    detail: "global feed",
    resources: ["18 skills", "6 extensions", "12 commands"],
    updated: "Auto-sync: On launch",
    status: "Active",
    official: true,
  },
  {
    id: "team-shared-prompts",
    name: "team-shared-prompts",
    kind: "Git Repository",
    location: "git@github.com:org/prompts.git",
    detail: "SSH key: id_ed25519",
    resources: ["4 prompts", "2 skills"],
    updated: "Last synced 3h ago",
    status: "Active",
    branch: "main",
  },
];
