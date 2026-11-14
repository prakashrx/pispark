#!/bin/sh
# Installs PiSpark for this Linux user, or updates or repairs an existing install:
#
#   curl -fsSL https://raw.githubusercontent.com/prakashrx/pispark/main/install/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/prakashrx/pispark/main/install/install.sh | sh -s -- --channel latest --port 3000
#
# Options: --channel stable|latest, --port <n>, --no-autostart, --no-open; or PISPARK_CHANNEL, PISPARK_PORT,
# PISPARK_HOME (data folder, default ~/.pispark) and PISPARK_INSTALL_DIR in the environment.
#
# What it does: downloads the newest release for this CPU from GitHub Releases, checks it against
# the release's SHA256SUMS, unpacks it into ~/.local/share/pispark/versions/<version>, then hands
# over to PiSpark's launcher, which sets up a systemd user service (starts at login; Restart on
# failure), the `pispark` command in ~/.local/bin, starts it and opens it if there is a desktop.
# No root needed. Your data stays in ~/.pispark. Remove PiSpark with: pispark uninstall
set -eu

channel="${PISPARK_CHANNEL:-stable}"
port="${PISPARK_PORT:-}"
autostart="yes"
open="yes"
root="${PISPARK_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/pispark}"
releases="${PISPARK_RELEASES_URL:-https://api.github.com/repos/prakashrx/pispark/releases?per_page=30}"
while [ $# -gt 0 ]; do
  case "$1" in
    --channel) channel="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --no-autostart) autostart="no"; shift ;;
    --no-open) open="no"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$channel" in stable|latest) ;; *) echo "--channel must be stable or latest" >&2; exit 2 ;; esac

say() { printf '%s\n' "$*"; }
fail() { printf 'PiSpark install: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || fail "this script is for Linux; on Windows use install.ps1"
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) fail "no PiSpark build for $(uname -m)" ;;
esac
command -v tar >/dev/null || fail "tar is needed"
if command -v curl >/dev/null; then get() { curl -fsSL -H "User-Agent: pispark-installer" "$1"; }; save() { curl -fSL --progress-bar -H "User-Agent: pispark-installer" -o "$2" "$1"; }
elif command -v wget >/dev/null; then get() { wget -qO- "$1"; }; save() { wget -q --show-progress -O "$2" "$1"; }
else fail "curl or wget is needed"; fi
if command -v sha256sum >/dev/null; then sum() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null; then sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
else fail "sha256sum is needed"; fi

say "PiSpark installer"
say "Finding the newest $channel release for linux-$arch..."
# Releases are listed newest first. A stable version has no "-" (0.4.2); a build of main does (0.4.3-main.…).
urls=$(get "$releases" | tr ',' '\n' | sed -n 's/.*"browser_download_url": *"\([^"]*pispark-[^"]*-linux-'"$arch"'\.tar\.gz\)".*/\1/p')
url=""
for u in $urls; do
  v=$(basename "$u" | sed 's/^pispark-\(.*\)-linux-'"$arch"'\.tar\.gz$/\1/')
  if [ "$channel" = "latest" ] || ! printf '%s' "$v" | grep -q -- '-'; then url="$u"; version="$v"; break; fi
done
[ -n "$url" ] || fail "no $channel release for linux-$arch was found"
target="$root/versions/$version"

if [ -f "$target/release.json" ]; then
  say "PiSpark $version is already downloaded."
else
  temp=$(mktemp -d)
  trap 'rm -rf "$temp"' EXIT
  name=$(basename "$url")
  say "Downloading PiSpark $version..."
  save "$url" "$temp/$name"
  get "$(dirname "$url")/SHA256SUMS" > "$temp/SHA256SUMS"
  expected=$(grep " \*\{0,1\}$name\$" "$temp/SHA256SUMS" | cut -d' ' -f1)
  [ -n "$expected" ] || fail "SHA256SUMS lists no $name"
  [ "$(sum "$temp/$name")" = "$expected" ] || fail "the download does not match SHA256SUMS; nothing was installed"
  say "Checked. Unpacking..."
  staging="$root/versions/.unpack-$version"
  rm -rf "$staging"; mkdir -p "$staging"
  tar -xzf "$temp/$name" -C "$staging"
  mv "$staging"/* "$target"
  rm -rf "$staging"
fi

# The launcher does the rest: the systemd user service, the pispark command, start and open.
set -- "$target/app/apps/launcher/dist/pispark.mjs" setup --channel "$channel"
[ -n "$port" ] && set -- "$@" --port "$port"
[ -n "${PISPARK_HOME:-}" ] && set -- "$@" --home "$PISPARK_HOME"
[ "$autostart" = "no" ] && set -- "$@" --no-autostart
[ "$open" = "no" ] && set -- "$@" --no-open
"$target/node/bin/node" "$@"

case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "Add ~/.local/bin to your PATH to use the pispark command." ;; esac
if [ "$autostart" = "yes" ] && command -v loginctl >/dev/null && [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo no)" != "yes" ]; then
  say "On a server, to keep PiSpark running while you are logged out, run once:"
  say "  sudo loginctl enable-linger $(id -un)"
fi
say "Done."
