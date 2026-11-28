/** How a file in a session's files folder can be shown, from its name. */
export type FileKind = "image" | "pdf" | "markdown" | "text" | "other";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const TEXT =
  /\.(txt|csv|tsv|json|jsonl|log|ya?ml|toml|ini|xml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|cs|sh|ps1|sql|env\.example)$/i;

export function fileKind(name: string): FileKind {
  if (IMAGE.test(name)) return "image";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (MARKDOWN.test(name)) return "markdown";
  if (TEXT.test(name)) return "text";
  return "other";
}

/** Where a session's file is read from (inert data, as the server serves attachments). */
export const fileUrl = (sessionId: string, name: string) => `/api/sessions/${sessionId}/attachments/${encodeURIComponent(name)}`;

/** Markdown can name an image in the current session by file path or by its attachment URL. */
export function sessionImageUrl(session: string, href: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(href).replaceAll("\\", "/");
  } catch {
    return undefined;
  }
  const route = fileUrl(session, "");
  const file = path.startsWith(route)
    ? path.slice(route.length)
    : /^(?:\.\/)?files\//.test(path)
      ? path.replace(/^(?:\.\/)?files\//, "")
      : /^(?:[A-Za-z]:)?\/(?!\/)/.test(path)
        ? path
            .split("/sessions/" + session + "/files/")
            .slice(1)
            .at(0)
        : undefined;
  if (!file || file.length > 200 || file.startsWith(".") || /[/:*?"<>|\u0000-\u001f\u007f]/.test(file) || fileKind(file) !== "image")
    return undefined;
  return fileUrl(session, file);
}
