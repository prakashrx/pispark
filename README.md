# PiSpark

**Quiet by default. Powerful when you reach for it.**

PiSpark is an open-source workspace for [Pi](https://github.com/earendil-works/pi-mono) agents, in the browser. It runs on your computer or your own server. You start a session with an agent in a folder; it works there and carries on when the browser is closed.

- **Composable agents:** an agent is a reusable setup of instructions, skills, `/commands`, extensions and model, built on other agents. Give it a folder and it's a project agent; give it its own screen and it's an app.
- **Any model Pi supports:** an API key or your Claude or ChatGPT subscription, chosen per session or agent.
- **[Pi extensions](docs/extensions.md)** run as they are, and can add their own interface to a session, up to a whole app.
- **Yours:** sessions, settings and sign-ins stay in one folder on your machine.

Several sessions run at once; sessions can be scheduled, run background processes and hand work to other sessions. Use it from your phone too (through Tailscale), with notifications when a session needs you.

Pi runs the agent. PiSpark hosts the experience. Extensions make it their own. ([VISION.md](VISION.md))

## Get it running

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/prakashrx/pispark/main/install/install.ps1 | iex
```

Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/prakashrx/pispark/main/install/install.sh | sh
```

PiSpark opens in your browser. Sign in under **Settings → Providers & models**, pick a folder, and ask.

## Docs

- [Installing, running and updating](docs/install.md): options, a second install, servers, uninstalling
- [Agents](docs/agents.md) · [Extensions](docs/extensions.md)
- [Development](docs/development.md): building from source, checks and tests · [Architecture](docs/architecture.md) · [Releasing](docs/releasing.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
