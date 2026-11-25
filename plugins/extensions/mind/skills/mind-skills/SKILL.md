---
name: mind-skills
description: How to turn steps you follow in this place into a skill in .mind/skills/, or improve one. Read this when you have followed the same steps here more than once, when the person corrected how you carried out a procedure, when they say "make that a skill" or "remember how to do this", or when a skill you used failed, was wrong, or didn't load when it should have.
license: Apache-2.0 (LICENSE.txt). Adapted from Anthropic's skill-creator by way of PiSpark's creating-skills; changed for skills an agent writes for itself in the place it works in.
---

# Skills for this place

A skill is a folder in `.mind/skills/` with a `SKILL.md`, plus any scripts or references it needs. Pi lists every skill's name and description at the start of a session and reads the rest only when a task matches. A skill costs nothing until it is needed, which makes it the right home for steps you follow here.

## 1. Decide whether it is a skill

- **A fact you know is a note. Steps you follow are a skill.** "Backups go to /var/backups/notes" is a note. "How to check and repair the backup" is a skill.
- **Only what is specific to this place.** If any capable agent would do it this way without being told, don't write it down. A skill earns its place with the real commands, paths, order, checks and traps of *this* place.
- **Only what has happened.** Write a skill for steps you have actually carried out here more than once, or that the person corrected. Not for something that might be needed one day.

If it doesn't pass, keep it as a line in the notes, or keep nothing.

## 2. Build it from what happened

Don't write it from memory or general knowledge. Go back to the evidence:

1. Read the notes that describe it: `.mind/notes.md` and its pages.
2. Find the runs where it was done. The lines under "Done lately" in `.mind/tasks.md` say what was done and when. Read those parts of the sessions if you can reach them.
3. Collect what actually worked: the exact commands and their order, the paths, what was checked afterwards, what went wrong the first time, and what the person corrected and why.

If you can't find enough to write exact steps, it isn't ready to be a skill. If the person asked for it, ask them for what is missing, a few questions at a time.

## 3. Write the description first

The description is how the skill gets loaded, so it decides whether the skill is ever used. It must say **what the skill does and when to use it**, with the situations and words that would really come up.

Models tend to load skills too rarely, so lean slightly towards inclusive:

- Weak: "Backup helper."
- Better: "Check and repair the nightly notes backup on this server: find the job, validate the newest archive, fix the source path, run a test backup. Use whenever backups are mentioned, a health check finds the archive old or missing, or the backup job reports an error."

All "when to use" belongs in the description, not the body: the body is read only after the decision. Keep it under 1024 characters.

## 4. Write SKILL.md

```markdown
---
name: repair-notes-backup
description: <what it does, and when to use it>
---

# Repair the notes backup

<the steps, the checks, what to report>
```

- **`name`** matches the folder: lowercase letters, numbers and single hyphens. A file that breaks this is refused when you save it.
- **Exact.** Give the real commands and paths, in the order that worked. Say what to check after each step that can fail, and what a good result looks like.
- **Imperative and direct.** Write it as instructions to a capable colleague who has never been here.
- **Explain why** a step matters instead of shouting ALWAYS and NEVER. The reason lets the reader handle a case you didn't foresee.
- **Say where it stops.** Name what needs the person's say (their instructions and `.mind/tasks.md` tell you what you may do alone).
- **Short.** Leave out what any capable agent already knows.

## 5. Scripts and references

Three levels keep context small:

1. **Name and description:** always in context. Around 100 words.
2. **`SKILL.md` body:** read when the skill loads. Keep it well under 500 lines.
3. **Files beside it:** read or run only when the body says to.

```
repair-notes-backup/
├── SKILL.md
├── scripts/          code for exact or repetitive steps
└── references/       detail read only when needed
```

When a step is exact and repetitive (a check, a report, a sequence of commands), put it in `scripts/` and have the skill run it. This is how you build your own tools here. Run a script once to prove it works before the skill relies on it. Refer to files by paths relative to the skill folder.

## 6. Leave no duplicate

Once the skill exists, remove its steps from the notes and leave one line pointing to it ("Repairing the backup: the `repair-notes-backup` skill"). Add a dated line under "Done lately" in `.mind/tasks.md` saying you wrote it.

## 7. Check it

- Read the description alone. Would a model choosing among many skills pick this one for the right tasks, and not for unrelated ones?
- Read the body as if you knew nothing else about this place. Can you follow it without guessing?
- A new skill is available from the next session, or after a reload. The next time the task comes up, follow the skill as written and fix whatever was unclear.

## 8. Improve it from use

When a run that used a skill failed, or the person corrected it, fix the skill, not only the run:

- **Generalize from what went wrong.** Fix the misunderstanding underneath, not just the one case.
- **Keep it lean.** Remove steps that don't pull their weight.
- **Explain the why** behind a correction rather than adding a rigid rule.
- **Bundle repeated work.** If you keep writing the same helper, put it in `scripts/`.

Remove a skill that no longer matches the place.

## Never

A skill must not contain anything that would surprise the person if described plainly: no hidden behaviour, no collecting data or credentials, no code that reaches beyond what the skill says it does. Never put a secret in a skill; say where the place keeps it.
