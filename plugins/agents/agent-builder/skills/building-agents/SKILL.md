---
name: building-agents
description: How to design a PiSpark agent that performs well, from interview to a composed set of instructions, skills, prompts and extensions. Read this whenever you start a new agent, reshape an existing one, decide which kind of resource a request needs, or review whether an agent is well built.
---

# Building agents

An agent is a composition, not a persona. "You are a senior reviewer" changes tone; it doesn't make the agent review well. What makes an agent good is the specific know-how, rules, shortcuts and tools it carries for the work it actually gets. Build from the work backwards.

## 1. Find out what the work is

Before designing anything, you need a clear answer to each of these. Find what you can in the files and the conversation; ask the person for the rest, a few at a time, each with a default they can accept.

| Question | Why it matters |
| --- | --- |
| What is the agent for, in one sentence? | Everything else is judged against this. |
| Who uses it, and how familiar are they with the subject? | Sets the level of explanation and how much to ask before acting. |
| Two or three typical requests, in the person's words | These become your test requests and show which kind of resource each need is. |
| What does a good result look like? A bad one? | The difference is usually the rule or know-how the agent is missing. |
| What must it never do? | Hard limits belong in instructions, or in a tool switch. |
| Which folders, services, files or tools does it touch? | Decides whether it needs a working folder, an extension, or tool switches. |
| Is there an existing workflow or document to capture? | Often the best source of the know-how: turn it into a skill. |

If the person gives you an example conversation, a checklist or a document, mine it first: the steps, the corrections they made, the formats they expect.

## 2. Decide what goes where

| The need | Kind | Notes |
| --- | --- | --- |
| A rule or habit needed in every session | Instruction | Short, specific, imperative. Read every session, so keep it lean. See `writing-instructions`. |
| Know-how or a procedure needed only for some tasks | Skill | Loaded only when its description matches. The bulk of an agent's expertise belongs here. See `creating-skills`. |
| A request the person repeats with small variations | Prompt | A `/name` command with arguments. See `writing-prompts`. |
| Doing something the built-in tools can't: an API, a service, a custom tool, a slash command with code, a view in PiSpark | Extension | Code, so it needs the most care. See `creating-extensions`. |
| Stopping it from doing something | A switch | `off: ["tool:bash"]` or `off: ["skill:x"]` in `agent.json`, more reliable than a rule asking it not to. |
| Always working in one project | `folder` in `agent.json` | Then it also reads that folder's `AGENTS.md`. |
| A preferred model or thinking level | `settings` in `agent.json` | Only when the work clearly needs it. |
| Most of another agent, plus a bit | `base` | Builds on that agent. Only inherit when you want everything it brings. |

Rules of thumb:

- **Reuse first.** Check Default, the parents and the Shared library (`<data folder>/resources/`) before writing something new.
- **Instructions say what and when; skills say how.** A long "how to do X" in instructions is a skill waiting to be extracted.
- **One skill per job**, named for the job, with a description that says when it applies.
- **Don't repeat what Default already says.** Read it first; duplicates waste every session's context and drift apart.

## 3. Agree the plan, then build in small steps

Lay out the plan: each file, its kind, why. Wait for a yes. Then build one piece at a time, checking each as you go. Large rewrites in one turn are hard for the person to review on the page.

## 4. Check it like a reviewer would

- Would each typical request reach the right resource? Is the skill's description specific enough to load for it?
- Is anything said twice, across instructions, skills or Default?
- Is every rule something the agent could actually follow? Vague rules ("be thorough") do nothing; specific ones ("run the tests before saying it's done") change behavior.
- Is every new file at the path the layout expects (`instructions/<name>.md`, `skills/<name>/SKILL.md`, …), and does `agent.json` reference each one by that name? A file at the wrong path is silently ignored.
- Is `agent.json` still valid JSON with known keys?
- Write two or three test requests, each with what a good answer looks like, for the person to try in a new session.

## 5. Improve from real use

An agent improves fastest from what went wrong on real requests. Ask what happened, find the missing rule, know-how or tool, and add the smallest thing that fixes it. Generalize: a fix that only works for the one example is not a fix.

## Common mistakes

- A personality instead of capabilities.
- One giant instruction file holding every procedure.
- Skills with vague descriptions ("helps with code") that never load, or load for everything.
- Rules in capitals instead of reasons. Explain why a rule matters; the agent follows reasons better than shouting.
- Inheriting a whole agent to reuse one skill. Reference the shared skill instead, or copy it locally.
- Building an extension when a skill with instructions for the built-in tools would do.

## How PiSpark stores an agent

Read [references/agent-format.md](references/agent-format.md) before editing `agent.json` or adding files: the folder layout, `resources` references, switches, layering, and how changes reach open sessions.
