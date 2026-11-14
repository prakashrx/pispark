# PiSpark

**Quiet by default. Powerful when you reach for it.**

PiSpark is an open-source workspace for [Pi](https://github.com/earendil-works/pi-mono) agents, in the browser. It runs on your computer or your own server. You start a chat in a folder, the agent works there, and the chat carries on when the browser is closed.

- **Any model Pi supports:** an API key or your Claude or ChatGPT subscription, chosen per chat or project.
- **[Personas](docs/personas.md)** shape an agent: instructions, skills, `/commands`, extensions and model, layered on a Default.
- **[Pi extensions](docs/extensions.md)** run as they are, and can add their own interface to the chat, up to a whole app.
- **Yours:** chats, settings and sign-ins stay in one folder on your machine.

Several chats run at once; chats can be scheduled, run background processes and hand work to other chats.

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
- [Personas](docs/personas.md) · [Extensions](docs/extensions.md)
- [Development](docs/development.md): building from source, checks and tests · [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
