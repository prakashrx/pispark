// Browser-local text only: callers own cancellation and replacement consent.
export function textError(text: string, maxBytes: number): string | undefined {
  if (!text.trim()) return "Enter some text.";
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    return `Use text of at most ${maxBytes} UTF-8 bytes.`;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    return "Use plain text without binary control characters.";
}

export async function importText(
  file: File,
  maxBytes: number,
): Promise<string> {
  const type = file.type.toLowerCase();
  if (!(type.startsWith("text/") || (!type && /\.(txt|md)$/i.test(file.name))))
    throw new Error("Choose a text file (.txt or .md), not a PDF or image.");
  if (file.size > maxBytes)
    throw new Error(`Choose a file of at most ${maxBytes} bytes.`);
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > maxBytes)
    throw new Error(`Choose a file of at most ${maxBytes} bytes.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The file must contain valid UTF-8 text.");
  }
  if (/^(%PDF-|GIF8[79]a)/u.test(text))
    throw new Error("Choose plain text, not PDF or image content.");
  const error = textError(text, maxBytes);
  if (error) throw new Error(error);
  return text;
}
