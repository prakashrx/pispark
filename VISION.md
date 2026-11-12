# PiSpark — Product Direction & Backend Foundation

**Status:** Direction for the next phase of development\
**Scope:** Product vision, architectural principles, and intended capabilities. Not an implementation specification.

## 1. Vision

**PiSpark is an open-source, self-hosted, web-native workspace powered by Pi.**

It combines the simplicity and accessibility of ChatGPT with the programmability and extensibility of Pi, while giving users ownership of their runtime, configuration, resources, and data.

PiSpark is not a terminal embedded in a browser, a replacement for Pi, or another agent framework.

It is a natural home for working with configurable Pi agents through a modern, deeply extensible web experience.

The guiding experience is:

**Quiet by default. Powerful when you reach for it.**

A new user should be able to open PiSpark and start a conversation immediately. An advanced user should be able to customize nearly every aspect of the agent's capabilities and interaction experience through Pi's existing extension ecosystem.

## 2. Foundational Philosophy

### Pi is the agent engine

Pi remains responsible for agent execution, model interaction, tools, context, compaction, and its native extension lifecycle.

PiSpark builds on Pi's Agent SDK and existing extension APIs.

It must not unnecessarily reproduce capabilities that Pi already provides or introduce competing abstractions.

PiSpark should remain compatible with Pi's evolution, keeping its own integration surface small and explicit.

### PiSpark is the workspace

PiSpark owns the web experience, session hosting, presentation, navigation, configuration experience, and communication between the browser and the Pi runtime.

It provides a consistent environment in which Pi agents and their extensions can operate.

PiSpark provides; it does not orchestrate. It starts, keeps, wakes, and shows sessions. Deciding what agents do, and in what order, belongs to Pi and to extensions.

The backend must exist independently of the web interface. A browser is a client of the runtime, not the owner of an agent session.

### Extensions own their experiences

Pi extensions remain ordinary Pi extensions.

They may contribute their own Svelte components, rendering logic, interactions, and visual experiences to PiSpark.

PiSpark provides the hosting environment, component loading, placement slots, lifecycle management, and communication bridge.

An extension decides what to present and how it behaves. PiSpark decides where and how it is hosted.

No separate PiSpark extension framework or mandatory manifest system should be introduced when Pi's existing extension APIs can serve the purpose.

## 3. The Core User Experience

The primary interaction is a clean, familiar conversational workspace.

A user can start a session by providing a prompt and selecting:

- **Working directory:** The starting location and filesystem context for the agent.
- **Persona:** A configured collection of agent capabilities.
- **Style:** An optional variation provided by the selected persona.
- **Model:** The model used for the session.

The persona determines the instructions, skills, extensions, commands, and other resources available to the agent.

Users should not need to understand Pi's internal architecture to use PiSpark.

Advanced configuration should be discoverable without making the everyday experience complicated.

Conversation is the default way in, not the only one. A persona may be an app: something a user opens rather than chats with, presenting its own experience (see §4).

## 4. Personas and Capability Composition

A persona is more than a system prompt or conversational personality.

It represents a reusable configuration of agent capabilities.

A persona may bring together instructions, skills, extensions, commands, model preferences, and resource access.

Users should be able to create, customize, and reuse personas.

Personas should be composed from existing Pi capabilities wherever possible, rather than introducing new equivalents.

Different personas may support different workflows, interaction styles, and tools while sharing the same underlying Pi runtime.

What a persona is used for comes from what it has, not from separate kinds:

- **Role persona:** capabilities only. The user brings the working directory when they ask.
- **Project persona:** a persona bound to a place, such as a project folder. It always works there.
- **App persona:** a persona with a home surface. It is opened rather than chatted with, and may also have a place.

These are combinations of one persona model, composable through persona layering, not three types.

A capability is not an app. An extension may offer its experience wherever it applies, such as in any session whose folder holds the records it understands, without being launched as an app.

### Apps

An app is a persona with a home surface. It becomes active when someone opens it or when something triggers it, and it may keep working in the background.

An app's backend is its ordinary Pi extensions, its frontend is their Svelte components, its workers are Pi sessions, and its state lives in its place: a project folder or its own data folder. There is no separate app entity, manifest, runtime, or store; Sources distributes personas.

An app may manage its own sessions: start them, follow them, and decide what they do. That orchestration belongs to the app. PiSpark provides the session lifecycle it needs and keeps every session inspectable.

## 5. Sources and Resource Discovery

PiSpark provides a way to discover and manage resources available to personas.

Sources may include Pi-compatible marketplaces, Git repositories, local resources, and other supported collections.

Users should be able to browse available skills, extensions, commands, and related resources, then choose which capabilities belong to a persona.

PiSpark manages the user experience of discovering, selecting, and configuring these resources.

Actual resource loading and execution should remain aligned with Pi's native mechanisms.

The goal is to make Pi's extensibility accessible through a friendly web interface without creating a competing package ecosystem.

## 6. Sessions and Runtime Independence

Sessions are owned by the backend runtime.

A session is a unit of agent work, not a chat. It may have many human turns or none, be driven from a page or a schedule, and have child sessions. Any session can be viewed as a conversation; the conversation is one surface over a session, shown when a user wants it, not what the session is.

Work is woken by triggers: a user opening or asking, a schedule, an event, or another session. Nothing runs unless something asks. A session that is not needed is not kept loaded; a trigger loads it, the work runs, and it can be unloaded again. Unattended work is off unless a user turns it on for a persona, and every unattended run remains an inspectable session.

They must not depend on an active browser tab to exist.

PiSpark should support independent sessions, including multiple sessions operating concurrently.

The runtime should provide a coherent lifecycle for starting, interacting with, observing, cancelling, and resuming sessions where supported.

The web interface should be able to disconnect and reconnect without treating the agent as a disposable browser process.

PiSpark's clients are the web workspace and, later, mobile; they use the same runtime. Bridging to messaging services or other outside channels is something an app may do through its own extensions; PiSpark does not need to know about it.

PiSpark's configuration, credentials, resources, and session history must remain independent of any separately installed terminal Pi environment unless explicitly configured otherwise.

## 7. Web-Native Pi Extensions

**This is a defining capability of PiSpark.**

Pi's extension system should become substantially more expressive when used through a web interface.

A Pi extension may provide custom Svelte view components alongside its existing agent-side logic.

These components may present anything appropriate to the extension's purpose: interactive results, visualizations, controls, forms, inspectors, status displays, or complete specialized interfaces.

The extension retains ownership of its presentation and behaviour.

PiSpark must not require extensions to express their interfaces exclusively through a fixed collection of built-in UI widgets.

### Extension placement

PiSpark provides well-defined places where extension components can appear.

These may include session headers, footers, side panels, conversation turns, tool results, contextual surfaces, hover interfaces, and other workspace locations.

Places exist beyond a single session too: an app's launcher, tiles on a home view, and notifications.

Some components may remain visible throughout a session. Others may appear dynamically in response to agent activity or user interaction.

Placement is a responsibility of PiSpark. Content and behaviour belong to the extension.

An extension offers its components; it does not force a layout. When several offers want the same place, PiSpark shows them side by side and lets the user choose. Visibility follows the user first, then the persona, then the extension. An extension may ask for attention, but PiSpark does not decide an extension's experience for it, and an extension does not take over the workspace.

### Extension communication

Pi's existing event-driven extension APIs form the foundation for communication.

PiSpark bridges the relevant extension events and interactions between the backend runtime and browser.

Extension-owned Svelte components should have a simple host communication interface, conceptually including:

- `host.call()` — invoke extension-owned functionality and receive a response.
- `host.on()` — subscribe to extension-owned events and updates.

The extension should not need to know the underlying browser transport or PiSpark's internal session-management implementation.

PiSpark should not need to understand the domain-specific meaning of an extension's events or interactions.

### Extension lifecycle

PiSpark is responsible for loading, mounting, updating, and disposing of extension components as appropriate to their placement and session lifecycle.

The experience should remain coherent across navigation, session changes, disconnection, and reconnection.

Third-party component execution must be treated as a deliberate trust and security boundary.

### Compatibility with terminal Pi

Extensions should continue to use Pi's native extension mechanisms.

The reason is the existing ecosystem: third-party Pi extensions should work in PiSpark without changes made for PiSpark. Terminal Pi is not a PiSpark client.

Web-specific presentation capabilities should be additive rather than requiring changes to Pi itself.

An extension may still support both terminal Pi and PiSpark, providing richer presentation when PiSpark is available.

## 8. Architecture Direction

The backend should follow a small number of clear ownership boundaries.

**Agent runtime:** Integrates with Pi's SDK and manages agent execution without reimplementing Pi.

**Session hosting:** Owns session identity, lifecycle, continuity, and concurrent operation independently of connected clients.

**Resource composition:** Resolves the configuration and Pi resources associated with personas and sessions.

**Client communication:** Connects the backend runtime to the web interface and potentially other future clients.

**Extension UI hosting:** Bridges Pi extension capabilities to the browser, enabling extension-owned Svelte components to participate in the workspace.

These are conceptual responsibilities, not a mandate to introduce separate services, packages, or framework layers.

The implementation should discover the simplest useful boundaries through real integration work.

## 9. Engineering Principles

PiSpark should inherit Pi's emphasis on simplicity and explicit design.

Prefer small, understandable modules over elaborate frameworks.

Reuse Pi's existing capabilities instead of building parallel systems.

Keep runtime logic independent of the web presentation.

Build reusable, consistent UI foundations without restricting extension-owned interfaces.

Avoid speculative abstractions, unnecessary dependencies, premature generalization, and configuration complexity.

Treat extension contracts as stable boundaries, but introduce them only when their purpose is clear.

Keep user-facing functionality truthful. Unimplemented capabilities should never appear to operate successfully.

Maintain clear ownership of state, resources, errors, cancellation, and cleanup.

The goal is a codebase that remains approachable, adaptable, and maintainable as PiSpark grows.

## 10. What PiSpark Is Not

PiSpark is not intended to be:

- A replacement for Pi or its Agent SDK.
- A fork of Pi's terminal application.
- A browser-based terminal emulator.
- A separate agent orchestration framework. Apps may orchestrate their own sessions; PiSpark provides the sessions.
- A competing extension or package ecosystem.
- A rigid UI framework that dictates how extensions must render.
- A distributed services platform built in anticipation of hypothetical scale.

Its value comes from combining Pi's existing power with an accessible, programmable web-native workspace.

## 11. Direction for the Next Development Phase

The next phase is to establish the backend foundation that can support this vision.

The immediate goal is not to implement every capability described here.

It is to create a working foundation that connects PiSpark's existing frontend to real Pi-powered sessions while preserving the architectural boundaries needed for future extensibility.

The work should progress through small, verifiable capabilities, beginning with real agent execution and session interaction, then establishing resource composition and the extension-to-web communication model.

The extension hosting direction should influence foundational decisions from the beginning, even if advanced rendering capabilities arrive later.

Before implementation, inspect Pi's current SDK and extension APIs and determine which responsibilities PiSpark genuinely needs to own.

Do not treat the conceptual responsibilities in this document as prescribed modules, classes, protocols, or storage choices.

The implementing agent should propose the smallest coherent backend design consistent with this direction, identify unresolved decisions, and obtain approval before substantial implementation.

## 12. Long-Term Product Identity

PiSpark should feel like ChatGPT when someone simply wants to ask a question.

It should feel like Pi when someone wants to customize their agent's capabilities.

And it should go beyond both when an extension introduces a specialized, interactive web experience, up to a complete app a user opens and leaves working.

**Pi runs the agent. PiSpark hosts the experience. Extensions make it their own.**

That is the direction against which future backend and product decisions should be evaluated.