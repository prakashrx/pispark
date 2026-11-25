# mind

**Experimental.** What an agent keeps for itself in the place it works in, so that you don't repeat yourself and it can carry its own work across sessions and unattended runs. Add it to an agent with `bundled:mind`.

## What you say goes where you'd have put it yourself

There is no new store for your instructions. The agent edits the files PiSpark already loads into every session, and tells you in one line what it saved and where.

| You say | It goes to |
|---|---|
| A rule for this project, for any agent | The project's `AGENTS.md` (when this agent reads it: a project agent) |
| How this agent should work or talk with you | This agent's own instructions |
| Something every agent should do | Default's instructions (it asks first) |
| A fact about the place | `.mind/notes.md` |
| Something to do | `.mind/tasks.md` |

An agent with no instructions of its own starts `instructions/standing.md`, which is selected for it like any instruction you add in the editor.

## What the agent produces lives in `.mind/`

One folder per place (the session's working folder), with a fixed layout:

```
.mind/
  notes.md          what's true about this place: the overview, read every run
  notes/<topic>.md  detail, one topic per page: listed every run, read when needed
  tasks.md          waiting on you · doing · to do · done lately
  attachments/      files that a task or a note links to
  skills/<name>/    steps the agent follows here: Pi skills, with their scripts
```

- **`notes.md`** has three sections: *What this is*, *How it's set up*, *Things to know*. It describes how things are now, is rewritten in place, and stays under 6,000 characters. Detail moves to a page, which starts with its title and a one-sentence summary.
- **`tasks.md`** has four sections: *Waiting on you*, *Doing*, *To do*, *Done lately*. One bullet per item. A line under *Done lately* starts with its date (`- 2026-11-26: …`).
- **`skills/`** holds ordinary Pi skills. They load through Pi's `resources_discover`, from the next session or after a reload.

The agent writes these with its ordinary file tools. There are no special tools to learn.

## How it stays clean

- **Every write is checked** against the layout. One that breaks it is refused with the reason, and nothing else can be created in the folder.
- **Earlier versions are kept** for every change to these documents and to your instruction files (the newest 200), so any change can be undone from the view.
- **Mechanically:** *Done lately* keeps its newest 30 lines. An attachment nothing links to is removed after a week.
- **Reminders:** at the end of a run that did work but kept nothing, and before PiSpark compacts the conversation, the agent is asked once to bring its tasks and notes up to date. After a compaction it is told to reorient from its tasks.
- **Tidy:** `/mind tidy`, or weekly from the view, checks the notes against how things are and clears what's stale (the `mind-tidy` skill).

## Asking without stopping

When the agent needs you and can go on meanwhile, it writes the question under *Waiting on you* and carries on. When its run ends, each new question is put to you once as a question card, which also reaches your phone through PiSpark's "needs you" notification. Your answer is written under the question and given to the agent to act on.

## The Mind view

Beside the conversation: what waits on you (answer there), the tasks, the notes and their pages, the skills, and what changed lately with **Undo**. `/mind` opens it.

## Skills that come with it

- **`mind-skills`**: how to turn steps the agent has followed here into a skill in `.mind/skills/`, built from what actually happened, and how to improve one. Adapted from Anthropic's skill-creator (Apache-2.0).
- **`mind-tidy`**: how to tidy the folder.

## Files it keeps for itself

`.mind/.gitignore` (the folder ignores itself in git; remove it to track the folder), `.mind/.history/` (earlier versions) and `.mind/.state.json` (which questions were already put to you).
