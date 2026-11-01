export async function copyText(text: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(text);
    return "Copied to clipboard";
  } catch {
    return "Clipboard unavailable. Select the text and copy it manually.";
  }
}
