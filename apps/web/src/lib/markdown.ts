import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(text: string): string {
  if (!text?.trim()) return "";
  return marked(text) as string;
}
