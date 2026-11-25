---
name: writing-instructions
description: How to write or improve an agent's instructions, the always-on rules added to every session's system prompt. Read this before adding, rewriting, reordering or trimming instructions, or when an agent ignores a rule or its instructions have grown long.
---

# Writing instructions

Instructions are added to the system prompt of every session, before the first message. They're the agent's standing rules. Because they're always there, they're the most expensive place to put words, and the most powerful place to put the few rules that must always hold.

## What belongs here

- How the agent works with people: when to ask, when to act, how to report.
- Hard limits and the reason for each.
- Conventions that apply to nearly every request: formats, naming, where outputs go.
- Pointers to skills for the detailed procedures ("Read the `release-checklist` skill before preparing a release").

What doesn't: step-by-step procedures for some tasks (skills), reference material (skill references), repeatable requests (prompts), and anything Default or a parent already says.

## Write rules an agent can follow

- **Specific beats general.** "Be careful with data" does nothing. "Never delete files outside the project folder; move them to `trash/` instead" changes behavior.
- **Give the reason.** "Run the tests before saying it's done, because the person merges on your word" is followed more reliably, and generalizes better, than "ALWAYS run tests". Capitals and stacked MUSTs are a sign the reason is missing.
- **Imperative and direct.** "Ask before changing the schema," not "It would be good if the agent asked…".
- **Say what to do, not only what not to do.** Pair each limit with the alternative.
- **One idea per bullet**, grouped under short headings when there are more than a handful.
- **Examples sparingly**, only where the rule is easy to misread. One good example beats three.

## Keep them lean

Aim for the shortest text that produces the behavior. A focused agent rarely needs more than a few hundred words of instructions. When they grow:

1. Move procedures into skills, and leave a one-line pointer.
2. Delete rules the model already follows without being told.
3. Merge rules that say the same thing in different words.
4. Check Default and the parents, and remove anything repeated.

## Order and parts

Instructions are read in order: Default's, then each parent's, then this agent's, each layer in its listed order. Put the agent's purpose and the way it works with people first, then conventions, then limits. Split into separate files only when parts are genuinely independent, such as a shared "house style" used by several agents.

## When a rule isn't followed

Don't just repeat it louder. Ask why the agent missed it:

- Too vague to act on? Make it specific.
- Buried in a long list? Shorten the list or move it up.
- Conflicting with another rule, in this agent or an inherited one? Resolve the conflict.
- Needs know-how the agent lacks? That's a skill.
- Needs to be impossible rather than discouraged? Use a switch (`off: ["tool:bash"]`).

## Checking

Read the full instructions in order, as the model will, including Default's and the parents'. For each rule, picture a typical request and ask whether the rule would change what the agent does. If not, it's noise.
