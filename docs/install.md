# Installing, running and updating PiSpark

PiSpark installs per user with one line, runs in the background, and updates itself from GitHub Releases. Nothing else needs installing: each release brings its own Node. On Windows, PiSpark's agents run commands with Git Bash (Git for Windows); the installer offers to install it.

## Install

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/prakashrx/pispark/main/install/install.ps1 | iex
```

Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/prakashrx/pispark/main/install/install.sh | sh
```

Options:
- **Channel:** Stable (tagged releases, the default) or Latest (every change merged to main): `$env:PISPARK_CHANNEL = "latest"` before the Windows line, `| sh -s -- --channel latest` on Linux.
- **Port:** 3000, or the next free port; set it with `PISPARK_PORT` or `--port`.
- **Data folder:** `PISPARK_HOME`.
- **Login start:** `--no-autostart` (`PISPARK_NO_AUTOSTART=1` on Windows) skips starting at login.

Running the line again repairs the install, or updates it.

The installer:
1. downloads the newest release for your OS and CPU;
2. checks it against the release's `SHA256SUMS`;
3. unpacks it;
4. hands over to the launcher's `pispark setup`. That sets up starting at login, adds the Start menu entry (Windows) and the `pispark` command, starts PiSpark and opens it.

| | Windows | Linux |
| --- | --- | --- |
| Program | `%LOCALAPPDATA%\Programs\PiSpark` | `~/.local/share/pispark` |
| Starts at login | a per-user Run entry (no admin) | a systemd user service, `pispark.service` |
| `pispark` command | `<program>\bin` (added to your PATH) | `~/.local/bin/pispark` |
| Your data | `~\.pispark` | `~/.pispark` |

**On a server (VPS):** to keep PiSpark running while you are logged out, run `sudo loginctl enable-linger $USER` once. PiSpark listens only on `127.0.0.1`. To reach it from your other devices, use a private network such as Tailscale (`tailscale serve 3000`); don't open the port to the internet.

## The program folder

```text
versions/<version>/   one folder per version: node/, app/, release.json
current               the running version (a junction on Windows, a symlink on Linux)
state.json            channel, port, automatic updates, data folder
update/               failed versions; the version being tried during a launcher switch (Linux)
logs/                 launcher.log, server.log (the newest 5 MB, then one older file)
pispark-start         Linux only: what systemd runs (see below)
```

The newest two versions are kept, so a failed update can switch straight back.

## The launcher

`pispark` (in `apps/launcher`) runs the server as its child process.
- **Crashes:** it restarts the server after a crash, and gives up after five quick crashes.
- **Graceful stop:** it stops the server over Node's IPC channel, which works on Windows, where a child process gets no SIGTERM.
- **Windows:** it runs from `node/pispark.exe`, which it makes from the release's Node when installed. It is the same program with its header marked windowed, so Windows opens no console for it. It also shows the tray.
- **Control channel:** the command line talks to the running launcher over a named pipe (Windows) or a socket in the program folder (Linux).

```text
pispark start | open | status | stop | restart | update | logs | uninstall [--purge]
```

`uninstall` keeps your data; `--purge` removes it too.

## Updates

The launcher checks your channel once a day, and whenever you press **Check now** in Settings → About.
1. **Download:** it downloads a newer release in the background, checks it against `SHA256SUMS` and unpacks it. Nothing running is touched.
2. **Ready:** Settings → About, the chats sidebar and the tray show **Update ready**.
3. **Something running:** if a reply or a background process is running, About says what, and offers **Update when idle** or **Update now**. Background processes end with the server; their agents are told.
4. **Restart:** the launcher stops the server gracefully and starts the new version's server. If it answers within 30 seconds, `current` points at it. If not, the previous version starts again, and the new one is marked failed and never offered again.
5. **Your windows:** open windows show "Updating PiSpark…" and reconnect by themselves.

When a release changes the launcher itself (`LAUNCHER_VERSION` in `apps/launcher/src/install.ts`), the launchers are switched in the same restart:
- **Windows:** the old launcher starts the new one and waits for it to report a healthy server before it exits. If the new one doesn't, the old launcher ends it and carries on.
- **Linux, under systemd:** the old launcher records the try in `update/`, points `current` at the new version and exits. systemd then runs `pispark-start`, which starts the new launcher. If the new launcher doesn't confirm itself within about 45 seconds, `pispark-start` puts the previous version back on the next start. Setup writes `pispark-start`; updates never change it.

**The data folder's layout** is recorded in `home.json` (`HOME_FORMAT` in `apps/server/src/core/home.ts`). A PiSpark that finds a newer layout than it knows, for example after going back to an older version, refuses to start rather than misread it.

**What is checked:** downloads come only from this repository's GitHub Releases over HTTPS and must match the release's `SHA256SUMS`. That catches damaged downloads, but not a compromised GitHub account; releases are not signed yet.

## Releases

`.github/workflows/release.yml` publishes them:
- a tag `v<version>` matching `package.json` publishes a Stable release;
- each push to main that passes CI publishes a Latest prerelease `<version>-main.<run>`, and keeps the newest 10.

To build one locally (Linux releases must be built on Linux, because Windows loses the executable bits):

```sh
npm run build
node scripts/release.mjs --version 0.1.0-main.1 --out release
```

`PISPARK_RELEASES_URL`, set when running `setup`, points an install at another release list, such as a mirror or a test feed. The launcher records it in `state.json`.
