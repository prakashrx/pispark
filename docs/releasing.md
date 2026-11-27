# Releasing

How a change becomes a version people install: what merging to main does, how a Stable release is cut, and where its notes come from. Installing and updating are in [install](install.md).

## Versions and channels

`package.json` holds the version being built toward, such as `0.7.0`. There are two channels:

| Channel | What it is | Version | Published when |
| --- | --- | --- | --- |
| Latest | Every change merged to main | `0.7.0-main.52` (the version, then the build number) | A push to main passes CI |
| Stable | A release you chose to make | `0.7.0` | The tag `v0.7.0` is pushed |

An install follows one channel ([install](install.md)): Stable sees only Stable releases, Latest sees both and takes the newest.

## Merging to main

1. The change comes with its notes: lines added to `docs/releases/<version>.md` for the version in `package.json` (see [Release notes](#release-notes)).
2. CI (`.github/workflows/ci.yml`) runs the checks, the tests, the build, the smoke run and the browser suite.
3. After the merge, when CI passes on main, `.github/workflows/release.yml` builds the archives for Windows x64, Linux x64 and Linux arm64 and publishes a Latest prerelease, `<version>-main.<run>`. It keeps the newest 10 builds of main and deletes older ones.

Nothing else is needed: a Latest install offers the new build on its About page.

## Cutting a Stable release

1. Read `docs/releases/<version>.md` through: it is what people will be told. Tidy it if several changes left it uneven.
2. Push the tag `v<version>`, which must match `package.json`. The same workflow builds and publishes the release.
3. Raise the version in `package.json` (and `package-lock.json`) and start `docs/releases/<new version>.md`, in one commit to main. Until the version is raised the workflow refuses to publish builds of main, so that they always sort after the newest Stable release.

Pushing a tag publishes: it needs the owner's word like any other publication.

## Release notes

One file per version, `docs/releases/<version>.md`, written in the same change as the code, newest change first. A build of main and the Stable release of the same version share the file, so no build number is needed to find it: `0.7.0-main.52` and `0.7.0` both read `docs/releases/0.7.0.md`.

- **Who they are for:** the person using PiSpark. They say what changes for them, why it is better, and what they need to do, if anything. They are not a record of the code; [AGENTS.md](../AGENTS.md) holds the rule and the style.
- **What gets a note:** anything a person can see, and anything that changes what an agent or an extension can do. Fixes and internal work nobody would notice need none.
- **Several branches at once:** the files merge by keeping both sides' lines (`merge=union` in `.gitattributes`), so two changes that each add notes do not conflict in a local merge or rebase. If a pull request still shows a conflict in that file, merge main into the branch locally, where it resolves itself. Read the file after such a merge: the order may need a touch.

## What a release holds

Each release has one archive per platform, `pispark-<version>-<os>-<arch>.tar.gz`, and `SHA256SUMS`. An archive holds the pinned Node runtime, the built server, web and launcher with the server's production dependencies, the built-in skills and bundled plugins, the docs (these notes included), and `release.json`, which says what the release is. `scripts/release.mjs` builds it.

To build one locally (Linux releases must be built on Linux, because Windows loses the executable bits):

```sh
npm run build
node scripts/release.mjs --version 0.1.0-main.1 --out release
```

## Not yet

- **The notes are not yet what a release says.** A published release still carries one fixed line and GitHub's generated list of merged pull requests. The workflow is to use `docs/releases/<version>.md` as the release's text, and to fail when that file is missing.
- **PiSpark does not show the notes itself.** When an update is available, "What's new" on the About page opens the release's page on GitHub. Showing the installed version's notes on the About page, from the files a release already carries, is to come.
