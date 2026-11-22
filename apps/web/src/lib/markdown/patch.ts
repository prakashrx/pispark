/**
 * Makes `target`'s children match `source`'s, touching only what differs: text grows in place,
 * elements of the same kind keep their identity (so selection, focus and loaded images survive),
 * and only nodes that changed kind are replaced. `source` is consumed.
 */
export function patch(target: Node, source: Node): void {
  const wanted = Array.from(source.childNodes);
  wanted.forEach((node, index) => {
    const current = target.childNodes[index];
    if (!current) target.appendChild(node);
    else if (current.nodeType !== node.nodeType || current.nodeName !== node.nodeName) target.replaceChild(node, current);
    else if (current.nodeType === Node.ELEMENT_NODE) {
      syncAttributes(current as Element, node as Element);
      patch(current, node);
    } else if (current.nodeValue !== node.nodeValue) setText(current as CharacterData, node.nodeValue ?? "");
  });
  while (target.childNodes.length > wanted.length) target.lastChild!.remove();
}

/** Changes only what follows the common start, so a selection in the text survives it growing. */
function setText(text: CharacterData, next: string): void {
  const now = text.data;
  if (next.startsWith(now)) return text.appendData(next.slice(now.length));
  let same = 0;
  while (same < now.length && same < next.length && now[same] === next[same]) same++;
  text.replaceData(same, now.length - same, next.slice(same));
}

function syncAttributes(current: Element, next: Element): void {
  for (const { name } of Array.from(current.attributes)) if (!next.hasAttribute(name)) current.removeAttribute(name);
  for (const { name, value } of Array.from(next.attributes)) if (current.getAttribute(name) !== value) current.setAttribute(name, value);
}
