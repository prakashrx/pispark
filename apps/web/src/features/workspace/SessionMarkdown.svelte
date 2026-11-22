<script lang="ts">
  import { getAllContexts, mount, unmount, untrack } from "svelte";
  import { Markdown, type FenceRenderer, type MarkdownOptions } from "../../lib/markdown";
  import { attention } from "../../shell/attention.svelte";
  import { sessionImageUrl } from "../files/file-kinds";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { contributionsFor } from "./extension-views";
  import { useSession } from "./session-client.svelte";

  /**
   * Markdown in a session: its own files show as images, and a fenced block whose language an
   * extension of the session draws (`markdown.fence:<language>`) is drawn by that extension.
   */
  let { text, streaming = false, flavor }: { text: string; streaming?: boolean; flavor?: MarkdownOptions["flavor"] } = $props();
  const session = useSession();
  const contexts = getAllContexts();

  function fences(language: string): FenceRenderer | undefined {
    const point = `markdown.fence:${language}`;
    if (!contributionsFor(session?.doc?.extensions, point).length) return undefined;
    return (target, code) => {
      const drawn = mount(ContributionPoint, { target, props: { point, data: { language, code } }, context: contexts });
      return () => void unmount(drawn);
    };
  }

  // Read once: a text keeps its flavor and session.
  const options: MarkdownOptions = {
    flavor: untrack(() => flavor),
    fences,
    images: session ? (href) => sessionImageUrl(session.id, href) : undefined,
    onCopy: (copied) => attention.say(copied ? "Code copied" : "Couldn’t copy the code"),
  };
</script>

<Markdown {text} {streaming} {options} />
