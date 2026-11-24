---
name: building-agents
description: How to design a PiSpark agent that performs well, from interview to a composed set of instructions, skills, prompts and extensions. Read this whenever you start a new agent, reshape an existing one, decide which kind of resource a request needs, or review whether an agent is well built.
---

# Building agents

An agent is a composition, not a persona. "You are a senior reviewer" changes tone; it doesn't make the agent review well. What makes an agent good is the specific know-how, rules, shortcuts and tools it carries for the work it actually gets. Build from the work backwards.

## 1. Find out what the work is

Before designing anything, you need a clear answer to each of these. Find what you can in the files and the conversation; ask the person for the rest in their own terms, a few at a time, each with a default they can accept. Never ask them to pick techniques or kinds of item.

| What you need to know | Asked plainly | Why it matters |
| --- | --- | --- |
| The goal behind the request | "What goes wrong today? What would be different if this worked?" | Everything is judged against it. "Explain clearly" may really mean "think clearly first". |
| Who uses it, and how much they know | "Is this just for you?" | Sets the level of explanation and how much to ask before acting. |
| Typical moments of use | "When would you reach for it? What would you type?" | These become test requests, and show which kind of item each need is. |
| How often, for how long | "Every day? A few minutes, or longer?" | Short daily use wants drills and reminders; occasional use wants a strong first answer. |
| What they bring | "Do you have notes, files or a folder for this already? Where?" | Existing material is the best source of know-how; its folder may be the working folder. |
| What happens without them | "Should it remind you, or send a summary now and then?" | Becomes a routine. |
| What they want to see | "Would a list or a dashboard of your progress help?" | Becomes an extension's view. |
| What good and bad look like | "Show me one you liked and one you didn't." | The difference is usually the rule or know-how the agent lacks. |
| What it must never do | "Anything it should never touch or do?" | Hard limits go in instructions, or in a tool switch. |

If the person gives you an example conversation, a checklist or a document, mine it first: the steps, the corrections they made, the formats they expect.

## 2. Choose the agent's shape

Most agents are one of a few shapes. Pick the one that fits the goal, then fill it in. Say which shape you chose and why in the plan.

| Shape | Fits when | Usually made of |
| --- | --- | --- |
| **Assistant** | They want help doing a kind of task on request: review code, draft emails, answer questions about a topic | Instructions (how it works, limits), skills for each procedure, a prompt or two for frequent requests |
| **Coach or practice app** | They want to get better at something over time: a skill, a habit, a subject | Instructions (coaching style, honesty), skills for each exercise and for giving feedback, prompts to start a drill, an extension that keeps practice results and shows progress in a home view, a routine for a daily drill or weekly review, and their material as the working folder |
| **Project agent** | The work happens in one folder: a codebase, a vault, a document set | `folder` set to it, instructions with that project's conventions (or its own `AGENTS.md`), skills for its recurring jobs |
| **Tool or app** | It must act on something the built-in tools can't reach, or keep data of its own: an API, a service, a tracker, a dashboard | An extension with tools (and a home view if they'd look at it), instructions for when to use them, skills for the know-how |

A goal like "get better at…", "keep track of…" or "help me every day with…" is rarely an assistant: it needs memory of what happened (data kept by an extension), something to look at (a view), and something that happens without being asked (a routine). Don't settle for an instruction file when the goal is a practice or a habit.

## 3. Decide what goes where

| The need | Kind | Notes |
| --- | --- | --- |
| A rule or habit needed in every session | Instruction | Short, specific, imperative. Read every session, so keep it lean. See `writing-instructions`. |
| Know-how or a procedure needed only for some tasks | Skill | Loaded only when its description matches. The bulk of an agent's expertise belongs here. See `creating-skills`. |
| A request the person repeats with small variations | Prompt | A `/name` command with arguments. See `writing-prompts`. |
| Doing something the built-in tools can't: an API, a service, a custom tool, a slash command with code, a view in PiSpark | Extension | Code, so it needs the most care. See `creating-extensions`. |
| Stopping it from doing something | A switch | `off: ["tool:bash"]` or `off: ["skill:x"]` in `agent.json`, more reliable than a rule asking it not to. |
| Always working in one project or folder | `folder` in `agent.json` (an absolute path) | A project agent also reads that folder's `AGENTS.md`. |
| Something that happens on a schedule | `routines` in `agent.json` | Each routine runs a prompt as a new session; the person switches it on. See `docs/agents.md`. |
| Keeping data and showing it | An extension with tools and a `session.view` | The extension stores the data in the session or a file in the working folder, and offers a view. Read `creating-extensions`. |
| A preferred model or thinking level | `settings` in `agent.json` | Only when the work clearly needs it. |
| Most of another agent, plus a bit | `base` | Builds on that agent. Only inherit when you want everything it brings. |

Rules of thumb:

- **Reuse first.** Check Default, the parents and the Shared library (`<data folder>/resources/`) before writing something new.
- **Instructions say what and when; skills say how.** A long "how to do X" in instructions is a skill waiting to be extracted.
- **One skill per job**, named for the job, with a description that says when it applies.
- **Don't repeat what Default already says.** Read it first; duplicates waste every session's context and drift apart.

## 4. Agree the plan, then build in small steps

Lay out the plan: each file, its kind, why. Wait for a yes. Then build one piece at a time, checking each as you go. Large rewrites in one turn are hard for the person to review on the page.

## 5. Check it like a reviewer would

- Would each typical request reach the right resource? Is the skill's description specific enough to load for it?
- Is anything said twice, across instructions, skills or Default?
- Is every rule something the agent could actually follow? Vague rules ("be thorough") do nothing; specific ones ("run the tests before saying it's done") change behavior.
- Is every new file at the path the layout expects (`instructions/<name>.md`, `skills/<name>/SKILL.md`, …), and does `agent.json` reference each one by that name? A file at the wrong path is silently ignored.
- Is `agent.json` still valid JSON with known keys?
- Write two or three test requests, each with what a good answer looks like, for the person to try in a new session.

## 6. Improve from real use

An agent improves fastest from what went wrong on real requests. Ask what happened, find the missing rule, know-how or tool, and add the smallest thing that fixes it. Generalize: a fix that only works for the one example is not a fix.

## Common mistakes

- A personality instead of capabilities.
- Building after a couple of answers, before the goal and the shape are clear.
- An instruction file for a goal that needs practice, memory or reminders.
- One giant instruction file holding every procedure.
- Skills with vague descriptions ("helps with code") that never load, or load for everything.
- Rules in capitals instead of reasons. Explain why a rule matters; the agent follows reasons better than shouting.
- Inheriting a whole agent to reuse one skill. Reference the shared skill instead, or copy it locally.
- Building an extension when a skill with instructions for the built-in tools would do.

## How PiSpark stores an agent

Read [references/agent-format.md](references/agent-format.md) before editing `agent.json` or adding files: the folder layout, `resources` references, switches, layering, and how changes reach open sessions.
