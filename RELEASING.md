# Releasing HTTiny

Installers are built and published by `.github/workflows/release.yml`. Pushing a version tag
is the whole process; nothing is uploaded by hand.

## Publishing a release

1. Bump the version in the two source manifests, keeping them byte-for-byte identical:
   - `frontend/package.json` → `"version"`
   - `build/config.yml` → `info.version`
2. Propagate it into the packaging metadata, which carries the version too — it is what
   the installers, the `.deb` and the `.app` bundle actually report:

   ```bash
   wails3 update build-assets -dir build -config build/config.yml -name HTTiny -binaryname httiny
   rm -rf build/ios   # recreated every time; this project is desktop-only
   ```

   Then **reapply the two deliberate local edits it discards** (see the last section), and
   check nothing was missed:

   ```bash
   grep -rn "<old version>" build frontend/package.json   # must return nothing
   ```

   Editing those files by hand is the smaller change when the CLI is not to hand, and the
   `grep` above is what proves it was complete. Seven files under `build/` carry the number:
   `config.yml`, `windows/info.json` (three fields), `windows/nsis/wails_tools.nsh`
   (`INFO_PRODUCTVERSION`, which becomes the `DisplayVersion` in Add/Remove Programs),
   `windows/wails.exe.manifest`, `darwin/Info.plist` and `darwin/Info.dev.plist`, plus
   `linux/nfpm/nfpm.yaml`. Every one of them except `config.yml` sat at `0.22.8` for fourteen
   minor releases, because `config.yml` and `frontend/package.json` are the only two CI
   verifies — the `grep` is the only thing that catches the rest.

3. Commit the bump.
4. Tag the commit with `v` + the same number and push it:

   ```bash
   git tag v0.20.2
   git push origin main
   git push origin v0.20.2
   ```

The workflow refuses to build if the tag and the two manifests disagree. The installers carry
the manifest version, not the tag, so a mismatch would publish a release advertising a number
nothing was built with — it fails in `verify`, before anything is compiled.

## What gets built

| Platform | Runner | Artifact |
| --- | --- | --- |
| Windows | `windows-latest` | `httiny-<version>-windows-amd64-installer.exe` (NSIS, per-user install, no UAC) |
| macOS | `macos-latest` | `httiny-<version>-macos-universal.dmg` (Intel + Apple Silicon) |
| Linux | `ubuntu-24.04` | `httiny-<version>-linux-amd64.AppImage`, `…-linux-amd64.deb` and `…-linux-x86_64.rpm` |

Asset filenames are lowercase `httiny`, matching the binary and the repository. Everything a
person reads — the launcher entry, the installed executable, the macOS bundle, Add/Remove
Programs — says `HTTiny`. See the naming note in CLAUDE.md before changing either.

Linux is pinned to `ubuntu-24.04` because Wails v3 targets GTK4 and WebKitGTK 6.0. Ubuntu 22.04
only ships WebKit2GTK 4.1 and would need the `-tags gtk3` opt-in. For the same reason the `.deb`
depends on `libgtk-4-1` and `libwebkitgtk-6.0-4`, so it installs on Ubuntu 24.04+ / Debian 13+
and not on older releases.

## How the workflow is shaped

The release is created **once** as a draft, before the build matrix runs, and every platform job
uploads into that same draft. A final job flips it to published. This matters: if each matrix job
created its own release, the GitHub API races with itself and the per-OS artifacts end up split
across duplicate drafts.

If a platform fails, the draft stays unpublished with only the artifacts that made it. Delete the
draft release before re-pushing the tag, otherwise the retry uploads into a half-filled one.

## Testing the pipeline without releasing

Run the workflow manually from the Actions tab (`workflow_dispatch`). It runs the same matrix but
creates no release: the installers land in the run's own artifact list. Use this instead of
pushing throwaway tags.

## Updates

Installed copies check `manifest.json` on the latest release at startup, so publishing a
release publishes the update. The `manifest` job builds and signs it, and refuses to
continue if `UPDATER_PRIVATE_KEY` is missing — an unsigned manifest is rejected by every
client, so failing loudly beats shipping one.

The manifest lists **one artifact per platform**, and which one differs by how each
platform applies an update:

| Platform | Payload | How it applies |
| --- | --- | --- |
| Windows | the NSIS installer | run silently with `/S`, so Add/Remove Programs, the shortcut and the uninstaller all stay correct |
| macOS | `httiny-<version>-macos-universal.zip` | the updater swaps the `.app` bundle and relaunches |
| Linux | the AppImage | **detection only** — nothing on Linux ever downloads it |

Linux always sends people here, to the releases page: a `.deb` or `.rpm` belongs to the
package manager and lives in root-owned paths.

**The signing key is the whole trust model.** `build/updater.key.pub` is committed and
compiled into the binary; it is the only key an installed copy will accept. The private
half exists solely in the `UPDATER_PRIVATE_KEY` secret. Losing it means no future release
can be verified by anything already installed — the fix would be shipping a new public
key, which only reaches people who update manually first. Back it up like a code-signing
certificate.

Rotating the key is a two-release process for the same reason: ship the new public key
first, then start signing with the new private key only once that release is widespread.

## Code signing

There is none. The installers are unsigned, so:

- **Windows** shows a SmartScreen warning on first run — *More info* → *Run anyway*.
- **macOS** Gatekeeper blocks a double-click; the app has to be opened with right-click → *Open*
  the first time. The `.app` is ad-hoc signed by the packaging task, which is not the same thing
  as a Developer ID signature.

The signing tasks already exist (`windows:sign`, `darwin:sign:notarize`, `linux:sign:deb`) and
read their certificates from `wails3 setup`. Wiring them into CI needs an Apple Developer
Program membership and/or an Authenticode certificate.

## Regenerating the packaging assets

`build/windows/`, `build/darwin/` and `build/linux/` come from the Wails CLI, but **never point
`wails3 generate build-assets` at `build/`** — it extracts its template with `os.Create` and would
truncate `build/config.yml` and `build/Taskfile.yml`, both of which are hand-maintained here.
Generate into a scratch directory and copy across what you need.

`wails3 update build-assets -dir build -config build/config.yml -name HTTiny -binaryname httiny`
is safe for `config.yml` and `Taskfile.yml`, but it *does* rewrite the templated files and will
discard two deliberate local edits:

- `build/windows/info.json` — the language key is `0409` (en-US), not the template's `0000`
  (language-neutral), and `fixed.product_version` is set. See the note in CLAUDE.md.
- `build/linux/nfpm/nfpm.yaml` — the homepage points at this repository, `license` is `MIT`
  (the template emits nothing, so it has to be reapplied), and the icon installed is
  `build/appicon.svg` into `hicolor/scalable/apps/` rather than the 1024×1024
  `build/appicon.png` into `hicolor/128x128/apps/`, whose directory name lied about the size.

It also recreates `build/ios/`, which this desktop-only project does not use; delete it.
