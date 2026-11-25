---
name: writing-prompts
description: How to write a prompt template for an agent, a reusable /name command with arguments. Read this when the person repeats a request, asks for a slash command or shortcut, or wants to turn a common message into one they can run quickly.
---

# Writing prompts

A prompt is a Markdown file in the agent's `prompts/` folder. Typing `/name` sends its text, with the arguments filled in, as if the person had typed it. It adds no code and no standing rules: it's a saved message.

## When a prompt is right

- The person sends the same kind of request often, with small changes: `/review payments`, `/changelog 0.6.0`.
- The request is clear once written down; the agent already knows how to do it.

If the request needs a procedure the agent doesn't know, write a skill and keep the prompt short, pointing at it. If it needs to run code, that's an extension command.

## The format

`prompts/changelog.md` becomes `/changelog`:

```markdown
---
description: Draft the changelog for a release
argument-hint: "<version> [since-tag]"
---
Draft the changelog for version $1, covering changes since ${2:-the last release tag}.
Group entries under Added, Changed and Fixed, one line each, in the person's words.
Leave out internal refactors.
```

- **`description`** shows in the slash picker. Say what it does in a few words.
- **`argument-hint`** shows after the name: `<required>`, `[optional]`.
- **Substitutions:**
  - `$1`, `$2`: one argument each;
  - `$@`: all arguments;
  - `${1:-default}`: a default when the argument is missing;
  - `${@:2}`: arguments from the second on.

  Arguments are split like a shell, so `/review "API changes"` is one argument.
- The file name is the command, lowercase with hyphens. Add `local:<name>` to `resources.prompts` in `agent.json`.

## Write it well

- Write it as the best version of what the person would type: the goal, the scope, the output they want.
- Use defaults so the bare command still does something sensible.
- Keep it to a few lines. Standing rules belong in instructions, procedures in skills.

## Checking

Read it with the arguments filled in, with and without the optional ones, and make sure each version reads as a clear request. Give the person one or two example invocations to try.
