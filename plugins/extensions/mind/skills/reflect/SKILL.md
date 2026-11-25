---
name: reflect
description: Use when asked to reflect on a closed goal, or to sweep this place's mind, to keep only what outlasts the work and tidy what's pending.
---

# Reflect

Memory is for working better next time: not repeating mistakes, not asking twice, knowing how things are done here. It is not a record of what happened; the sessions already are that. Most of a finished goal should be forgotten.

## After a goal closes

1. **Read what you need**: the card, and the parts of its session that show decisions, corrections, surprises and how the work was actually done. Skim the rest.
2. **Ask of each candidate: will this matter after this goal?** Discard by default. Leave out what the place can tell you again (code, docs, history) and details tied to this goal (names, numbers, commits, dates).
3. **What usually survives:**
   - A **fact** about this place or the person that wasn't obvious and cost time to learn → a knowledge proposal.
   - A **procedure** that was worked out, repeated or corrected → a skill (`mind_record`, part `skill`). Propose a new one, or a change to an existing skill that failed or was corrected. Keep it to the steps: short, exact, reusable.
   - **The person's intent or a principle** they showed → a charter proposal.
   - **How they want you to behave** → a contract proposal. Rules they already confirmed are in the contract; don't repeat them.
   - **A product decision** belongs in the product. If the place doesn't hold it yet, add one idea card to write it down there, rather than remembering it.
4. **Propose few, and make each one count.** Use `mind_record` with origin `inferred` and a one-line reason naming where it came from. Zero proposals is a fine outcome.
5. **Retire the card** (`mind_work` action `retire`) as the prompt says, then finish with one short line: what you proposed, or "nothing to keep".

## Sweep

Run now and then (`/mind sweep`, or on a schedule). Tidy first, ask last:

- **Ideas** untouched for weeks: drop the ones that no longer fit the charter or the work; keep the rest as they are.
- **Proposals** that waited long, were overtaken, or duplicate each other: withdraw them (`mind_record` op `withdraw`). Merge duplicates into one new proposal.
- **Closed cards** still in the work list: reflect on them as above, then retire them.
- **Over budget**: propose merging or generalising notes; propose removing knowledge nobody needed.

End with at most three lines for the person, only for things that need them. If nothing does, say so in one line.
