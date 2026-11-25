# mind

Memory and attention for any agent. Add it to an agent (`bundled:mind`) and the agent keeps four parts in `.mind/` inside the folder it works in:

| Part | Holds | Changed by |
|---|---|---|
| Charter | Why it's here, for whom, what good looks like, what's off-limits | The person |
| Contract | What it owns, tells, asks about, never does | The person |
| Knowledge | What's true here, beyond any one goal | The person, or proposals they accept |
| Work | Goals as cards, from idea to done or dropped | The agent, as it works |

- The charter, contract, active cards and knowledge index are pinned into the system prompt every run, within small token budgets, so compaction and new sessions don't lose them.
- The agent writes only through its tools: `mind_work` for cards, `mind_record` for the rest. What the person said in this conversation (quoted) is recorded; anything the agent infers becomes a proposal. Raw writes into `.mind/` are refused.
- `/mind` shows what's waiting on you; `/mind accept <id>`, `/mind reject <id>` and `/mind audit`.
- Skills in `.mind/skills/` load like any skill (Pi's `resources_discover`). The `discover` skill finds out a new place's charter; `adopt` brings an existing system in once.
- `.mind/` ignores itself in git.
