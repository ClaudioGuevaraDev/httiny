# HTTiny

A tiny, focused HTTP client for the desktop — dark, fast and frictionless. Built with Wails v3,
Go, React and Tailwind CSS.

[![Release](https://img.shields.io/github/v/release/ClaudioGuevaraDev/httiny?label=release)](https://github.com/ClaudioGuevaraDev/httiny/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Why a desktop app

Every request is performed by the Go process with `net/http`, not by the webview. That is the
whole reason this is a native application: a `fetch()` is subject to CORS, cannot set the
headers an HTTP client exists to set (`User-Agent`, `Cookie`, `Host`, `Referer`), and cannot
read an opaque response. Cancelling is real too — the Go context is cancelled and the socket
aborts, rather than the interface pretending the request is gone.

Nothing is simulated and there is no demo data. What you see is what a server answered.

## Features

**Requests.** `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS`, a params grid kept in sync
with the URL in both directions, a headers grid, and six body types — none, JSON, text,
multipart form, URL-encoded and binary. All four body payloads are kept whatever the type says,
so switching type and back returns what was there. Bearer and basic auth. A 30-second default
timeout and up to ten redirects, replayed correctly across a 307/308.

**Attachments are paths, never bytes.** A file is chosen through a native dialog and stored as
its path, so the workspace file stays small and portable, the attachment survives a restart, and
the grid can mark a file that has gone missing *before* a send fails. Multipart envelopes are
assembled in memory up to 64 MiB, which is what keeps `Content-Length` known and redirects
replayable.

**Collections, folders and tabs.** A windowed sidebar tree that stays responsive at thousands of
requests, a tab strip scoped to the collection you are in, and a `Ctrl+K` command palette that
reaches across all of them. Everything autosaves — there is no dirty flag and no "discard
changes?" dialog.

**Environments and `{{variables}}`.** Each collection owns its environments outright, with a
picker in its own sidebar panel. Substitution covers the URL, the query, headers, params, the
body and auth, and the query is walked structurally so a `{{token}}` typed into the params grid
is not percent-encoded into oblivion. A variable can be **locked**, which sends its value to the
OS credential store instead of the workspace file.

**A response viewer that covers what an endpoint actually returns.** Nineteen formats, decided
in Go by content type and by sniffing, in two families:

| Family | Formats | Rendered as |
| --- | --- | --- |
| Textual | `json` `ndjson` `xml` `html` `svg` `csv` `markdown` `yaml` `javascript` `css` `sse` `text` | A syntax-highlighted editor, plus a JSON tree, a CSV table, an event-stream reader, and sandboxed HTML and Markdown previews |
| Byte-backed | `image` `audio` `video` `pdf` `font` `archive` `binary` | Real viewers — an image, a seekable player, an embedded PDF, a font specimen, an archive listing, a hex dump |

Bytes stay in the Go process and reach the webview over an internal asset route, so a video can
seek and a PDF can page without a base64 round trip. Alongside the body: response headers,
cookies, a timeline, the redirect chain, in-body search, and saving the body to a file. Bodies
are read up to 32 MiB, and textual ones are trimmed to 5 MiB before crossing into the editor;
either case is reported as truncated rather than quietly cut.

**Code view.** "What would you send?" answered by the same code path that sends it — fourteen
targets, generated from the resolved request rather than from a second guess at it:

Raw HTTP · curl · curl (PowerShell) · HTTPie · wget · JavaScript `fetch` · axios ·
Python `requests` · `httpx` · Go `net/http` · Java `HttpClient` · C# `HttpClient` ·
Ruby `net/http` · Rust `reqwest`

Every literal is quoted for the shell or language it lands in, and credentials can be redacted
to a placeholder before you paste a snippet into an issue.

**The interface.** Light, dark or system theme; interface zoom and a separate code text size;
the response beside the request or below it; English and Spanish; configuration export and
import; and in-app updates on Windows and macOS.

## Keyboard

`Ctrl` is `⌘` on macOS.

| Keys | Action |
| --- | --- |
| `Ctrl` `Enter` | Send the request |
| `Esc` | Cancel the request in flight |
| `Ctrl` `S` | Write the workspace to disk now |
| `Ctrl` `N` | New request |
| `Ctrl` `W` | Close the tab |
| `Ctrl` `K` | Command palette |
| `Ctrl` `F` | Find in the response body |
| `Ctrl` `E` | Environments for the collection on screen |
| `Ctrl` `'` | Code view |
| `Ctrl` `B` | Show or hide the sidebar |
| `Ctrl` `\` | Switch the request/response split |
| `Ctrl` `,` | Settings |
| `Ctrl` `+` `-` `0` | Zoom in, out, reset |

## Download

Installers for Windows, macOS and Linux are attached to every [release](https://github.com/ClaudioGuevaraDev/httiny/releases).

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `httiny-<version>-windows-amd64-installer.exe` | Installs per user, so it never asks for administrator rights |
| macOS | `httiny-<version>-macos-universal.dmg` | Universal — Intel and Apple Silicon |
| Linux | `httiny-<version>-linux-amd64.AppImage`, `.deb` or `.rpm` | Needs GTK4 and WebKitGTK 6.0 — Ubuntu 24.04+ / Debian 13+, or Fedora 40+ |

The binaries are **not code-signed**. Windows SmartScreen warns on first run — *More info* →
*Run anyway* — and macOS Gatekeeper needs the app opened with right-click → *Open* the first
time. See [RELEASING.md](RELEASING.md) for how the installers are built.

## Where your data lives

Two files under your user config directory — `%AppData%\HTTiny` on Windows,
`~/Library/Application Support/HTTiny` on macOS, `$XDG_CONFIG_HOME/HTTiny` on Linux. Set
`HTTINY_DATA_DIR` to put them somewhere else.

- `workspace.json` — collections, requests and environments. Portable, diffable and
  hand-editable. Written atomically, and quarantined rather than deleted if it ever becomes
  unreadable.
- `ui.json` — tabs, selection, layout and preferences. Machine-specific, and kept separate so
  dragging a split handle never rewrites the file holding your requests.

**Credentials are in neither file.** Bearer tokens, basic-auth passwords and locked environment
variables go to the operating system's credential store — Credential Manager, Keychain, or
Secret Service — which is what makes the workspace file safe to copy, commit or attach to a bug
report. If no credential store is reachable, the app says so in the sidebar footer and keeps
those values for the session only.

## Development

Requirements: Go 1.26+ (as pinned in `go.mod`), Node.js 22+ and pnpm 11 (pinned in
`frontend/package.json` through `packageManager`, so pnpm fetches the right version itself), the
Wails v3 CLI, and the native GTK/WebKit dependencies for your platform.

```bash
cd frontend
pnpm install
pnpm run dev        # Vite in a plain browser
```

```bash
wails3 task dev     # the native app, with frontend hot reload
wails3 task build   # frontend/dist/, then bin/httiny
```

| Command | What it does |
| --- | --- |
| `pnpm run lint` | `tsc -b` and then ESLint — the gate that matters, since ESLint does not emit compiler diagnostics |
| `pnpm run build` | Lints, then builds `frontend/dist/`; a lint failure aborts before Vite runs |
| `pnpm run format` | Prettier over `src/` and the root configs |

`pnpm run dev` has no Go process behind it, so every send fails with `BACKEND_UNAVAILABLE` by
design and the byte route does not exist at all. It is for working on the interface; use
`wails3 task dev` to send real requests. There is intentionally no test framework at this
stage — verification is `pnpm run lint`, `pnpm run build`, and looking at the app.

## Layout

```
main.go                 the Wails application: one window, the bound services, the asset route
internal/httpexec/      every outbound request, response classification, snippet input
internal/workspace/     persistence and the import/export envelope
internal/secrets/       the OS credential store
internal/updates/       what "apply an update" means on each platform
frontend/src/           the React SPA — store.ts owns shared state, components/ the interface
frontend/bindings/      generated from the Go services, and committed: it is an input to tsc
build/                  packaging metadata for Windows, macOS and Linux
```

[CLAUDE.md](CLAUDE.md) documents the architecture and the reasoning behind it,
[AGENTS.md](AGENTS.md) the contributor guidelines, and [RELEASING.md](RELEASING.md) the release
process.

## License

[MIT](LICENSE) © 2026 Claudio Guevara
