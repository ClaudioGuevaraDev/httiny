import { lazy } from 'react'

/**
 * `TextBody`, deferred — declared once here because four modules render it.
 *
 * `BodyPanel`, `CsvTable`, `JsonTree` and `SseBody` all reach for the read-only editor,
 * and two of them already live in lazy chunks. Wrapping `lazy()` at each of those four
 * call sites would give Rollup four split points for one module and four separate
 * `lazy()` caches for one component; importing this instead gives it one.
 *
 * It is the last static edge from the first paint into CodeMirror on the response side:
 * `TextBody` pulls `@uiw/react-codemirror` and `response/syntax.ts`, and `syntax.ts` both
 * imports five `@codemirror/legacy-modes` grammars and *builds* them at module scope,
 * before any response exists. Every one of the four renders inside the `<Suspense>` that
 * `BodyPanel` already has, so no new boundary is needed.
 */
export const TextBody = lazy(() => import('./TextBody').then(module => ({ default: module.TextBody })))
