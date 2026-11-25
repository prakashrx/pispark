# mind

Memory and attention for any agent. Add it to an agent (`bundled:mind`) and the agent keeps four parts in `.mind/` inside the folder it works in:

| Part | Holds | Changed by |
|---|---|---|
| Charter | Why it's here, for whom, what good looks like, what's off-limits | The person |
| Contract | What it owns, tells, asks about, never does | The person |
| Knowledge | What's true here beyond any one goal, and skills for how things are done here | The person, or proposals they accept |
| Work | Goals as cards, from idea to done or dropped | The agent, as it works |

- **Pinned:** the charter, contract, active cards and knowledge index are pinned into the system prompt every run (one `mind` section, within small token budgets), so compaction and new sessions don't lose them. After a compaction the agent is told to reorient from its card.
- **Written only through its tools:**
  - `mind_work` for cards.
  - `mind_record` for the rest. What the person said in this conversation (quoted) is recorded. `ask` puts a yes/no question to them now. Anything inferred becomes a proposal.
  - `mind_decide` asks for a decision: one question, a recommendation, at most three options and a safe default.
  - Raw writes into `.mind/` are refused.
- **Learning:**
  - When a card closes, a reflection runs in a child session with fresh context. It proposes what outlasts the goal (facts, skills, principles) and retires the card.
  - A run whose words read like a correction or a standing preference gets one hidden reminder to keep the lesson.
  - `/mind sweep` tidies ideas, proposals and closed cards. Schedule it to run periodically.
- **The Mind view** (beside the conversation) shows what waits on you, the charter, contract, work and knowledge. Accept, reject or forget from there, or with `/mind accept <id>`, `/mind reject <id>`. Also: `/mind reflect`, `/mind audit`.
- **Skills** in `.mind/skills/` load like any skill (Pi's `resources_discover`). Bundled skills:
  - `discover` (a new place's charter),
  - `adopt` (bring an existing system in once),
  - `reflect` (reflection and the sweep).
- `.mind/` ignores itself in git.
