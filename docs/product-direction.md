# Product direction

PiSpark aims to be an open, deeply customizable home for agent-assisted work: simple to start, composable as needs grow, and not tied to a single interface.

**This document is future direction, not a list of shipped features or delivery promises.** The current starter has a web shell, a local-only demo composer, and backend health. It has no agent execution.

## The direction

### An independent Pi-powered runtime

Use Pi's Agent SDK directly from Node. PiSpark should own its configuration, resources, credentials, and sessions independently of any installed terminal Pi setup. Installing or using terminal Pi should not be a prerequisite, nor should PiSpark silently inherit its settings or history.

### Personas as composable capabilities

Personas should define what an agent can do, not only how it sounds. Explore composition of instructions, skills, tools, models, and permitted resources. A useful persona is an understandable capability bundle, not just a named personality. Its schema, composition rules, permissions, and lifecycle still need design and validation against the SDK.

### Sessions owned by the backend

Sessions should outlive a particular browser view. Headless and container operation should be possible without rendering the web UI. Future messaging interfaces should be able to interact with the same backend-owned sessions rather than create disconnected copies of the product.

Cross-interface identity, concurrent input, event replay, reconnect behavior, cancellation, and access control are open questions. Exact same-session behavior needs investigation; it is not claimed to work today.

### A web experience people can make their own

Svelte provides the starting point for a responsive, approachable workspace: an Ask surface, clear context, selectable personas/models, and room for sessions and projects when those concepts are implemented. Customization should extend beyond colors to useful workflows and capabilities, without forcing terminal-specific UI conventions into the browser.

Explore SDK extensions, skills, prompt templates, and package resources with explicit compatibility boundaries. Terminal UI hooks are not automatically web components. A future web contribution mechanism should be designed deliberately, not assumed from SDK extensibility.

### Simple, modular engineering

Prefer readable modules, a few reusable components, explicit ownership, and small verified increments. Avoid plugin frameworks, service fleets, databases, or shared packages until an actual requirement earns their complexity. Keep runtime logic independent of transport and presentation without inventing a broad framework in advance.

## Next increment

Validate a minimal Pi SDK integration with explicit resource loading and configuration isolation. Agree on one backend-owned session lifecycle and a truthful event flow before adding real model selection or executable personas to the UI. Decide credential and tool-permission handling before exposing execution.

## Deferred decisions

Storage, event transport, worker model, persona schema, extension contribution API, authentication, deployment/container packaging, and messaging adapters remain open. No hosting domain or release schedule is promised.

## References to investigate

- [Pi](https://github.com/earendil-works/pi-mono): SDK and resource/extension model
- [OpenClaw architecture](https://docs.openclaw.ai/concepts/architecture): gateway and multi-interface patterns
- [Hermes Agent](https://github.com/NousResearch/hermes-agent): headless operation and interface ideas

These are research references, not additional dependencies or selected architectures.
