<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import UserTurn from "./UserTurn.svelte";
  import ThoughtCard from "./ThoughtCard.svelte";
  import ToolCard from "./ToolCard.svelte";
  import CodeCard from "./CodeCard.svelte";
  import { conversation, sidebarCode } from "./fixtures";
</script>

<main
  id="workspace"
  aria-label="Fixture conversation; no agent or tools are running"
  class="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center"
>
  <div class="w-full max-w-4xl flex flex-col space-y-8">
    <header
      class="flex items-start justify-between pb-4 border-b border-zinc-100"
    >
      <div>
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-bold tracking-tight text-zinc-900">
            {conversation.title}
          </h1>
          <span
            class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Running
          </span>
        </div>
        <p class="text-xs text-zinc-400 font-mono mt-1">
          {conversation.folder} • {conversation.started}
        </p>
      </div>
      <div class="flex items-center gap-1.5 text-xs"></div>
    </header>
    <div class="space-y-7">
      <UserTurn {...conversation.first} />
      <div class="space-y-7" data-purpose="assistant-turn-stream">
        <div class="space-y-4">
          <ThoughtCard
            duration={conversation.review.duration}
            tokens={conversation.review.tokens}
            >{conversation.review.thought}<code>{conversation.review.path}</code
            >{conversation.review.thoughtEnd}</ThoughtCard
          ><ToolCard {...conversation.review.tool} />
          <div class="text-sm text-zinc-700 space-y-3 leading-relaxed">
            <p>{conversation.review.explanation}</p>
          </div>
          <CodeCard
            path={conversation.review.path}
            diff
            copy={conversation.diff.join('\n')}
            ><div
              class="flex items-center text-rose-600 bg-rose-50/60 px-2 py-0.5 rounded -mx-2"
            >
              <span class="w-5 select-none text-rose-400 font-bold">-</span
              ><code>{conversation.diff[0]}</code>
            </div>
            <div
              class="flex items-center text-emerald-700 bg-emerald-50/70 px-2 py-0.5 rounded -mx-2 mt-0.5"
            >
              <span class="w-5 select-none text-emerald-500 font-bold">+</span
              ><code>{conversation.diff[1]}</code>
            </div>
            <div
              class="flex items-center text-emerald-700 bg-emerald-50/70 px-2 py-0.5 rounded -mx-2 mt-0.5"
            >
              <span class="w-5 select-none text-emerald-500 font-bold">+</span
              ><code>{conversation.diff[2]}</code>
            </div></CodeCard
          >
          <div class="flex items-center gap-2">
            <div
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono bg-zinc-50 text-zinc-700 border border-zinc-200/80"
            >
              <Icon
                name="checkBold"
                class="w-3.5 h-3.5 text-emerald-600 flex-shrink-0"
              /><span
                >{conversation.review.tests.name} •
                <span class="text-zinc-900 font-semibold"
                  >{conversation.review.tests.summary}</span
                >
                <span class="text-zinc-400"
                  >{conversation.review.tests.duration}</span
                ></span
              >
            </div>
          </div>
        </div>
        <UserTurn {...conversation.followup} />
        <div class="space-y-4">
          <ThoughtCard duration={conversation.sidebar.duration}
            >{conversation.sidebar.thought}<code
              class="font-mono text-zinc-800 bg-zinc-200/50 px-1 py-0.5 rounded text-[10px]"
              >{conversation.sidebar.shortcut}</code
            >{conversation.sidebar.thoughtMiddle}<code
              class="font-mono text-zinc-800 bg-zinc-200/50 px-1 py-0.5 rounded text-[10px]"
              >{conversation.sidebar.path}</code
            >.</ThoughtCard
          ><ToolCard {...conversation.sidebar.tool} />
          <div class="text-sm text-zinc-700 space-y-3 leading-relaxed">
            <p>{conversation.sidebar.explanation}</p>
            <ul class="list-disc pl-5 space-y-1 text-xs text-zinc-600">
              <li>
                Binds <code
                  class="bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-800 font-mono text-[11px]"
                  >{conversation.sidebar.mod}</code
                >
                (<kbd class="font-sans">{conversation.sidebar.mac}</kbd> on
                macOS,
                <kbd class="font-sans">{conversation.sidebar.windows}</kbd> on Windows/Linux)
                to toggle sidebar collapsed state.
              </li>
              <li>{conversation.sidebar.editable}</li>
              <li>{conversation.sidebar.collapsed}</li>
            </ul>
          </div>
          <CodeCard path={conversation.sidebar.path}
            ><pre class="text-[11px]"><span class="text-zinc-400"
                >{sidebarCode.comment}</span
              >
<span class="text-purple-600">{sidebarCode.keyword}</span> <span
                class="text-blue-600">{sidebarCode.name}</span
              >{sidebarCode.signature}
  <span class="text-blue-600">{sidebarCode.register}</span>(<span
                class="text-emerald-600">{sidebarCode.shortcut}</span
              >{sidebarCode.callback}
    <span class="text-blue-600">{sidebarCode.toggle}</span>{sidebarCode.call}
  {sidebarCode.closeCallback}
{sidebarCode.close}</pre></CodeCard
          >
          <div class="flex flex-wrap items-center gap-2 pt-2">
            <Button
              unavailable="This action requires the backend; fixture transcript only"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-700 bg-white hover:bg-zinc-50 border border-zinc-200 shadow-elevation-sm transition-all hover:border-zinc-300"
              ><Icon name="check" class="w-3.5 h-3.5 text-zinc-400" /><span
                >Commit changes</span
              ></Button
            ><Button
              unavailable="This action requires the backend; fixture transcript only"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-700 bg-white hover:bg-zinc-50 border border-zinc-200 shadow-elevation-sm transition-all hover:border-zinc-300"
              ><Icon name="clipboard" class="w-3.5 h-3.5 text-zinc-400" /><span
                >Run linter</span
              ></Button
            >
          </div>
        </div>
      </div>
    </div>
    <div class="h-10"></div>
  </div>
</main>
