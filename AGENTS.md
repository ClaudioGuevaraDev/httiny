# Repository Guidelines

## Project Structure & Module Organization

HTTiny is a Wails v3 desktop application. Native application setup lives in `main.go`, and the bound Go services live under `internal/` (`httpexec` for outbound HTTP, `workspace` for persistence, `secrets` for the OS credential store). Go dependencies are declared in `go.mod`. Build orchestration and desktop metadata live in `Taskfile.yml` and `build/`.

The React/TypeScript frontend is under `frontend/`:

- `src/components/` contains focused UI components such as the sidebar, request editor, tabs, and response viewer.
- `src/store.ts` owns shared Zustand state and actions.
- `src/types.ts` defines request, response, and collection contracts.
- `src/goExecutor.ts` bridges the `RequestExecutor` contract to the Go `HTTPExec` service; `src/persistence.ts` and `src/workspaceFile.ts` own disk persistence. There is no demo data and nothing is simulated.
- `public/` contains static visual assets.

Generated directories such as `frontend/dist/`, `frontend/node_modules/`, and `bin/` must not be committed.

`frontend/bindings/` is generated but **is** committed, because it is an input to the TypeScript build and producing it requires the Go toolchain and the `wails3` CLI. Regenerate it with `wails3 task common:generate:bindings` after changing a bound Go signature; never edit it by hand.

## Build and Development Commands

Run frontend commands from `frontend/`. The package manager is pinned to pnpm 11 in `package.json` through the `packageManager` field, which pnpm honours by fetching that exact version; pnpm 11 requires Node.js 22 or newer.

- `pnpm install` installs locked dependencies.
- `pnpm run dev` starts the browser-based Vite development server.
- `pnpm run typecheck` validates TypeScript without emitting files.
- `pnpm run lint` runs the type check and then ESLint, so it reports both compiler errors and type-aware rule violations.
- `pnpm run build` lints and creates `frontend/dist/`; a lint failure aborts the build.
- `pnpm run format` and `pnpm run format:check` run Prettier over `src/` and the root configs.

From the repository root, `wails3 task dev` launches the native application with hot reload. `wails3 task build` creates the desktop binary. Linux development requires GTK4 and WebKitGTK 6.0 development packages.

## Coding Style & Naming Conventions

Use tabs in Go and two spaces in TypeScript, TSX, JSON, and YAML. Format Go changes with `gofmt`. Prefer strict TypeScript types and avoid `any`.

Use `PascalCase` for React components and exported types, `camelCase` for functions and state actions, and descriptive kebab-free filenames such as `RequestEditor.tsx`. Keep components focused; move shared state, fixtures, and request execution logic outside presentation components. Use Tailwind utilities or shared rules in `src/styles.css`, preserving the compact dark UI and green accent.

## Testing Guidelines

This stage intentionally has no automated test framework or test files. Do not introduce testing dependencies unless the project direction changes. Before submitting changes, run `pnpm run lint` and `pnpm run build`, then manually verify affected interactions in Vite or Wails.

ESLint and Prettier are configured in `frontend/eslint.config.js` and `frontend/.prettierrc.json`. Prettier matches the existing compact style (no semicolons, single quotes, no parens on single-argument arrows, `printWidth` 160) and is intentionally excluded from the lint and build gate, because the files written before it was introduced do not satisfy `format:check` yet.

## Commits & Pull Requests

The repository has no established commit history yet. Use concise imperative commits, for example `Add response error states`. Keep unrelated changes separate.

Pull requests should explain the behavior changed, list manual verification steps, and include screenshots or recordings for visual changes. Reference related issues and call out new dependencies, Wails configuration changes, or platform-specific requirements.

## Agent-Specific Versioning Rule

Whenever the user explicitly requests the `.agents/skills/conventional-commit` skill, update the application version before staging and committing. Treat versions as `A.B.C` and never change `A` unless the user explicitly asks for it — 1.0.0 was such a request, and it is the only one so far:

- Increase `B` and reset `C` to `0` for a new user-facing feature or a meaningful capability change.
- Increase only `C` for fixes, documentation, styling, refactors, dependency/build work, and other compatible maintenance.

Keep every application version reference synchronized, including `frontend/package.json` and `build/config.yml`, plus any future manifests or packaging metadata that expose the app version. Do not change Taskfile schema versions such as `version: '3'`.

Releases are tagged `v<version>` and must match those two files exactly. The release workflow verifies this and fails before building, because the installers carry the manifest version rather than the tag. See `RELEASING.md`.

## Dependency Version Policy

Declare every direct dependency and development dependency with an exact version. Do not use semver ranges such as `^`, `~`, `>`, or `*`. When adding a package, use an exact version (for example, `pnpm add library@1.2.3`) and commit the updated lockfile. Keep Go modules pinned to explicit versions in `go.mod` and retain `go.sum` integrity data.
