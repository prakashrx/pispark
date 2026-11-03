## What changed and why?

Which sections of [VISION.md](../VISION.md) does this change serve? State the scope, non-goals, and any unresolved conflicts. For architecture changes, explain what Pi already provides and what PiSpark genuinely needs to own.

## Verification

- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run smoke`
- [ ] UI changes checked at narrow/wide widths and with keyboard controls (if applicable)

## Boundaries

- [ ] Checked against VISION.md: Pi remains the engine, PiSpark hosts sessions/workspace, and extensions own their experiences.
- [ ] No competing agent/extension ecosystem or fixed-widget restriction on extension UI introduced.
- [ ] Docs and tests reflect the change; future direction is not described as implemented.
- [ ] No credentials, environment files, private work records, runtime metadata, or personal screenshots.

## Risks / follow-up

Include relevant issue links and any intentionally deferred work.
