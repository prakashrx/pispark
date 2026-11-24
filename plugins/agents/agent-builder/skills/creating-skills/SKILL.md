---
name: creating-skills
description: How to create or improve an agent skill, the on-demand know-how Pi loads when a task matches its description. Read this whenever the person wants the agent to know how to do something, to capture a workflow or checklist, to turn a conversation or document into reusable know-how, or when an existing skill doesn't load when it should or doesn't work well.
license: Apache-2.0 (LICENSE.txt). Adapted from Anthropic's skill-creator; changed by PiSpark for Pi agents, without its evaluation tooling.
---

# Creating skills

A skill is a folder with a `SKILL.md`, plus any scripts, references or assets it needs. Pi lists every skill's name and description in the system prompt, and the agent reads the full `SKILL.md` only when a task matches. That makes skills the right home for most of an agent's expertise: detailed, but costing nothing until needed.

## 1. Capture what it should do

If the conversation already holds the workflow ("turn this into a skill"), extract it first: the steps, the tools used, the corrections the person made, the formats they expected. Then fill the gaps with the person:

1. What should the agent be able to do with this skill?
2. When should it load: which requests, phrases or situations?
3. What does a good result look like, and what format should the output have?
4. Which edge cases, inputs, files or dependencies matter?

Ask a few at a time. Don't write until you can describe the skill's job in two sentences.

## 2. Write the description first

The description is how the skill gets loaded, so it decides whether the skill is ever used. It must say **what the skill does and when to use it**, with the concrete situations and words a person would actually use.

Models tend to load skills too rarely, so lean slightly towards inclusive:

- Weak: "Release helper."
- Better: "Prepare and check a release of the shop: version bump, changelog, tests, tag. Use whenever the person mentions releasing, shipping, tagging a version or writing release notes, even if they don't say 'release'."

All "when to use" belongs in the description, not the body: the body is read only after the decision. Keep it under 1024 characters.

## 3. Write SKILL.md

```markdown
---
name: release-checklist
description: <what it does, and when to use it>
---

# Release checklist

<the procedure, the rules, the output format>
```

- **`name`** matches the folder: lowercase letters, numbers and single hyphens, up to 64 characters.
- **Imperative and direct.** Write the procedure as instructions to a capable colleague.
- **Explain why** a step matters instead of shouting ALWAYS and NEVER. The model handles cases you didn't foresee better when it knows the reason.
- **Define the output** when the format matters, with a short template or one example.
- **General, not overfitted.** The skill will meet many requests, not just the examples you discussed.

## 4. Load detail only when needed

Three levels keep context small:

1. **Name and description**: always in context. Around 100 words.
2. **`SKILL.md` body**: read when the skill loads. Keep it well under 500 lines.
3. **Files beside it**: read only when the body says to.

```
release-checklist/
├── SKILL.md
├── references/       docs read when needed ("Read references/hotfix.md for a hotfix")
├── scripts/          code for repetitive or exact steps
└── assets/           templates and files used in the output
```

Point to each file from `SKILL.md` and say when to read it. Refer to files by paths relative to the skill folder. When a skill covers several variants, put the shared steps in `SKILL.md` and one reference file per variant.

## 5. Wire it into the agent

Write `skills/<name>/SKILL.md` in the agent's folder and add `local:<name>` to `resources.skills` in `agent.json`. If an equivalent skill already exists in the Shared library, suggest using it instead of writing a copy.

## 6. Check it, and give the person a way to try it

- Read the description alone. Would a model choosing among many skills pick this one for the right requests, and not for unrelated ones?
- Read the body as if you knew nothing else. Can you follow it?
- Write two or three realistic test requests, the kind a person would really type, each with what a good answer looks like. Include one that should **not** load the skill.

Simple one-step requests may not load any skill, because the agent handles them directly. Test with substantive requests.

## 7. Improve it from real use

When the person reports how it did:

- **Generalize from the feedback.** Fix the underlying misunderstanding, not only the one example.
- **Keep it lean.** Remove parts that don't pull their weight, especially ones that send the agent on unproductive detours.
- **Explain the why** behind a correction rather than adding a rigid rule.
- **Bundle repeated work.** If the agent keeps writing the same helper or doing the same multi-step routine, put it in `scripts/` or a reference, and tell the skill to use it.

## Never

Skills must not contain anything that would surprise the person if described plainly: no hidden behavior, no collecting data or credentials, no code that reaches beyond what the skill says it does.
