/**
 * The English catalogue, and the source of truth for the key set.
 *
 * `as const` at the bottom is load-bearing: it makes every value a string *literal*
 * type, which is what lets `Placeholders<S>` read the `{name}` slots out of a message
 * at compile time. Without it every value is `string`, and `t()` would silently accept
 * any params, or none.
 *
 * Keys are flat and dotted rather than nested. Three reasons: `keyof typeof en` is a
 * plain union with no recursive `Paths<T>` helper; `t(`error.${code}.title`)` and
 * `t(`editor.panel.${panel}`)` are checked against real keys, which nesting cannot do;
 * and one message per line keeps a diff readable at `printWidth: 160`.
 *
 * What is deliberately absent: HTTP methods, status reason phrases, format badges,
 * byte and time units, key-cap names, and the technical placeholders that are examples
 * of machine input. See CLAUDE.md for the full policy.
 */
export const en = {
  // ── App shell ────────────────────────────────────────────────────────────────
  'app.skipLink': 'Skip to Workspace',
  'app.resizeSidebar': 'Resize sidebar',
  'app.showSidebar': 'Show sidebar',
  'app.hideSidebar': 'Hide sidebar',
  'app.resizeColumns': 'Resize request and response columns',
  'app.resizeRows': 'Resize request and response rows',

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  'sidebar.nav': 'Collections',
  'sidebar.renameInput': 'Rename {name}',
  'sidebar.save.browser': 'Not saved — browser preview',
  'sidebar.save.newer': 'Newer workspace — not saving',
  'sidebar.save.failed': 'Save failed',
  'sidebar.save.saving': 'Saving…',
  'sidebar.save.noKeychain': 'Saved · no keychain',
  'sidebar.save.saved': 'Saved',
  // The footer shows the version number; this carries the sentence, for the tooltip
  // and for a screen reader, so an arrow and a number are never the only explanation.
  'sidebar.update': 'Update to {version}',
  'sidebar.noCollections.title': 'No collections yet',
  'sidebar.noCollections.desc': 'Collections group your requests. Create one to get started.',
  'sidebar.noCollections.action': 'New collection',
  // Secondary, beside "New collection": this placeholder is the one moment somebody with
  // a workspace elsewhere is looking at an empty app, and Settings is not where they
  // would think to look for the way out.
  'sidebar.noCollections.import': 'Import a workspace',
  'sidebar.empty.title': 'Nothing here yet',
  'sidebar.empty.desc': '“{name}” has no requests. Add one to send your first call.',
  'sidebar.empty.newRequest': 'New request',
  'sidebar.empty.newFolder': 'New folder',

  // ── Collection rail ──────────────────────────────────────────────────────────
  'rail.collections': 'Collections',
  'rail.showPanel.aria': 'Show collection panel',
  'rail.hidePanel.aria': 'Hide collection panel',
  'rail.showPanel.title': 'Show panel',
  'rail.hidePanel.title': 'Hide panel',
  'rail.newCollection': 'New collection',

  // ── Tab strip ────────────────────────────────────────────────────────────────
  'tabs.list': 'Open requests',
  'tabs.close': 'Close {name}',

  // ── Workspace actions ────────────────────────────────────────────────────────
  'workspace.sideBySide.aria': 'Switch to side-by-side layout',
  'workspace.stacked.aria': 'Switch to stacked layout',
  'workspace.sideBySide.title': 'Side by side ({keys})',
  'workspace.stacked.title': 'Stacked ({keys})',
  'workspace.palette.aria': 'Open command palette',
  'workspace.palette.title': 'Search ({keys})',
  'workspace.settings.aria': 'Open settings',
  'workspace.settings.title': 'Settings ({keys})',

  // ── Request editor ───────────────────────────────────────────────────────────
  'editor.empty.title': 'No request open',
  'editor.empty.desc': 'Open something from the sidebar, or start a new request.',
  'editor.empty.newRequest': 'New request',
  'editor.empty.import': 'Import a workspace',
  'editor.method': 'HTTP method',
  'editor.url': 'Request URL',
  'editor.code.title': 'Show the code for this request ({keys})',
  'editor.send.title': 'Send request ({keys})',
  'editor.cancel.title': 'Cancel request ({keys})',
  'editor.send': 'Send',
  'editor.cancel': 'Cancel',
  'editor.sections': 'Request sections',
  'editor.panel.params': 'Params',
  'editor.panel.headers': 'Headers',
  'editor.panel.body': 'Body',
  'editor.panel.auth': 'Auth',
  // Two counts, not one: Spanish agrees the adjective with the noun, and these render
  // under Params (m.) and Headers (f.) respectively.
  'editor.panel.paramsEnabled.one': ', {count} enabled',
  'editor.panel.paramsEnabled.other': ', {count} enabled',
  'editor.panel.headersEnabled.one': ', {count} enabled',
  'editor.panel.headersEnabled.other': ', {count} enabled',
  'editor.kv.key': 'Key',
  'editor.kv.value': 'Value',
  'editor.kv.description': 'Description',
  'editor.kv.keyPlaceholder': 'Key…',
  'editor.kv.valuePlaceholder': 'Value…',
  'editor.kv.descriptionPlaceholder': 'Optional description…',
  'editor.kv.enableNamed': 'Enable {name}',
  'editor.kv.enableRow': 'Enable row',
  'editor.kv.deleteRow': 'Delete row',
  // Whole sentences rather than "Add" + a noun: the article and the gender travel
  // with the noun in Spanish.
  'editor.kv.addParam': 'Add Parameter',
  'editor.kv.addHeader': 'Add Header',
  'editor.body.type': 'Body type',
  'editor.body.none': 'None',
  // JSON and TEXT are tokens and stay as they are; these three are words.
  'editor.body.form': 'Form',
  'editor.body.urlencoded': 'URL-encoded',
  'editor.body.binary': 'Binary',
  'editor.body.formatJson': 'Format JSON',
  'editor.body.emptyTitle': 'No body',
  'editor.body.emptyDesc': 'Pick a body type above to send one.',
  'editor.body.aria': 'Request body ({type})',
  // Form-data. The grid spends its last column on the part's Content-Type rather than
  // on a description: it is what an API that validates an upload actually reads.
  'editor.body.form.type': 'Type',
  'editor.body.form.field': 'Text',
  'editor.body.form.file': 'File',
  'editor.body.form.contentType': 'Content-Type',
  'editor.body.form.contentTypeAuto': 'From the extension…',
  'editor.body.form.rowKind': 'Part type for {name}',
  'editor.body.form.rowKindRow': 'Part type',
  'editor.body.form.addField': 'Add Field',
  'editor.body.form.addFile': 'Add File',
  'editor.body.file.choose': 'Choose file…',
  'editor.body.file.remove': 'Remove',
  'editor.body.file.missing': 'File not found',
  'editor.body.file.missingHint': 'This path no longer points at a file. Choose it again before sending.',
  'editor.body.file.dialogTitle': 'Choose a file to attach',
  'editor.body.file.dialogTitleMany': 'Choose files to attach',
  // Says where the bytes are, because it is the one thing about this feature that is
  // not obvious: the workspace stores the path, not a copy of the file.
  'editor.body.binary.emptyTitle': 'No file chosen',
  'editor.body.binary.emptyDesc': 'The file you choose is sent as the entire request body, with no multipart wrapper.',
  'editor.body.binary.contentType': 'Content-Type',
  'editor.body.urlencoded.add': 'Add Field',
  'editor.auth.type': 'Auth type',
  'editor.auth.none': 'No Auth',
  'editor.auth.bearer': 'Bearer Token',
  'editor.auth.basic': 'Basic Auth',
  'editor.auth.noneNote': 'No auth. Requests are sent without credentials.',
  'editor.auth.token': 'Token',
  'editor.auth.username': 'Username',
  'editor.auth.password': 'Password',

  // ── Response ─────────────────────────────────────────────────────────────────
  'response.region': 'Response',
  'response.metric.time': 'Time',
  'response.metric.size': 'Size',
  'response.metric.elapsed': 'Elapsed',
  'response.metric.code': 'Code',
  'response.pill.sending': 'Sending…',
  'response.pill.failed': 'Failed',
  'response.pill.idle': 'No response yet',
  'response.announce.error': 'Request failed: {title}. {detail}',
  'response.copyBody.aria': 'Copy response body',
  'response.copiedBody.aria': 'Response body copied',
  'response.copyBody.title': 'Copy body',
  'response.copied.title': 'Copied',
  'response.save.aria': 'Save the response body to a file',
  'response.save.title': 'Save body',
  // The dialog's own title. It has to come from here rather than from Go, which has
  // no catalogue — see SaveRequest.Title.
  'response.save.dialog': 'Save response body',
  // Said before writing, not discovered afterwards: the file is whatever the panel is
  // showing, and these are the two ways that can differ from what the server sent.
  'response.save.truncated': 'Save body — only the part shown here, the response was truncated',
  'response.save.transcoded': 'Save body — as UTF-8, decoded from {charset}',
  'response.save.unavailable': 'This response has no body',
  'response.saved.live': 'Response body saved',
  'response.saveFailed.live': 'Could not save the response body',
  'response.clear.aria': 'Clear response',
  'response.clear.title': 'Clear',
  'response.copied.live': 'Copied to clipboard',
  'response.copyFailed.live': 'Could not copy — clipboard access was denied',
  'response.idle.title': 'Nothing sent yet',
  'response.idle.desc': 'Run this request to inspect its status, headers and body.',
  'response.idle.send': 'Send request',
  'response.loading.note': 'Waiting for a response… · {elapsed}',
  'response.loading.cancel': 'Cancel',
  'response.error.retry': 'Retry',
  'response.error.fixUrl': 'Fix the URL',
  'response.error.copyDetails': 'Copy Details',
  'response.error.copied': 'Copied',
  'response.sections': 'Response sections',
  'response.tab.body': 'Body',
  'response.tab.headers': 'Headers',
  'response.tab.cookies': 'Cookies',
  'response.tab.timeline': 'Timeline',
  'response.tab.returned.one': ', {count} returned',
  'response.tab.returned.other': ', {count} returned',
  'response.formatting': 'Body formatting',
  'response.mode.pretty': 'Pretty',
  'response.mode.raw': 'Raw',
  'response.mode.rich.unavailable': 'This format has no viewer of its own',
  'response.mode.pretty.unavailable': 'This format cannot be reformatted',
  // Never shown: `raw` is available for every body. Present because the label table is
  // keyed by mode, and a hole in it would be a type error rather than a missing tooltip.
  'response.mode.raw.unavailable': 'Always available',
  // What the first segment is called, per format. Four different promises, so four
  // different words — a control that said "Rich" for all of them would say nothing.
  'response.rich.tree': 'Tree',
  'response.rich.records': 'Records',
  'response.rich.preview': 'Preview',
  'response.rich.table': 'Table',
  'response.rich.events': 'Events',
  'response.rich.none': 'View',
  'response.wrap.aria': 'Wrap long lines',
  'response.wrap.title': 'Wrap lines',
  // Shown on the disabled state of each control. They say *why* it does not apply —
  // a greyed-out button with the same tooltip as the live one explains nothing.
  'response.copyBody.unavailable': 'This body is not text',
  'response.wrap.unavailable': 'Only the text view wraps',
  'response.hex.toggle.unavailable': 'This response has no body',

  // ── Response · find bar ──────────────────────────────────────────────────────
  'response.search.aria': 'Find in the response',
  'response.search.placeholder': 'Find…',
  'response.search.count': '{index} of {total}',
  'response.search.none': 'No matches',
  'response.search.previous': 'Previous match',
  'response.search.next': 'Next match',
  'response.search.caseSensitive': 'Match case',
  'response.search.regexp': 'Regular expression',
  'response.search.close': 'Close find',
  'response.search.unsearchable': 'This view cannot be searched.',
  'response.search.showAsText': 'Show as text',
  'response.search.capped': 'Stopped counting at {limit} matches.',
  'response.interpretAs': 'Interpret body as',
  // Only the formats whose name is a word rather than a token. The rest uppercase
  // themselves — see BODY_LANGUAGE_LABEL in responseBody.ts.
  'response.language.text': 'Text',
  'response.language.markdown': 'Markdown',
  'response.language.javascript': 'JavaScript',
  'response.language.sse': 'Server-sent events',
  'response.truncated': 'Showing the first {limit} of {size}.',
  'response.invalidJson': 'This body is not valid JSON — showing it as it arrived.',
  // The charset and the compression algorithm are protocol tokens and arrive as
  // params, so no catalogue entry has to spell "ISO-8859-1" correctly.
  'response.encoding.transcoded': 'Decoded from {charset}.',
  'response.encoding.decompressed': 'Decompressed from {encoding}.',
  'response.encoding.unsupported': 'This body is {encoding}-compressed, which HTTiny cannot decode — showing the raw bytes.',

  // ── Response · media and bytes ───────────────────────────────────────────────
  'response.bytes.gone.title': 'Body no longer held',
  'response.bytes.gone.desc': 'HTTiny keeps only the most recent response bodies in memory. Send the request again to see it.',
  'response.hex.summary': '{size} · {rows} rows of 16 bytes',
  'response.hex.aria': 'Hexadecimal view of the response body',
  'response.hex.toggle.aria': 'Show the body as hexadecimal',
  'response.hex.toggle.title': 'Hex view',
  'response.image.zoom': 'Image scale',
  'response.image.fit': 'Fit',
  'response.image.actual': '1:1',
  'response.image.dimensions': '{width} × {height}',
  'response.image.alt': 'The image returned by this request',
  'response.image.broken.title': 'Image could not be decoded',
  'response.image.broken.desc': 'The bytes arrived, but this build has no decoder for them. The hex view still shows what was sent.',
  'response.audio.broken.title': 'Audio could not be played',
  'response.video.broken.title': 'Video could not be played',
  'response.media.broken.desc': 'Nothing here can decode {type}. The hex view still shows what was sent.',
  'response.media.unknownType': 'this format',
  'response.pdf.aria': 'The PDF returned by this request',
  'response.pdf.unsupported.title': 'No PDF viewer available',
  'response.pdf.unsupported.desc': '{size} of PDF arrived, but this platform’s webview has no built-in viewer for it.',
  'response.svg.view': 'SVG view',
  'response.svg.preview': 'Preview',
  'response.svg.source': 'Source',
  'response.svg.alt': 'The SVG returned by this request',
  'response.font.sample': 'Sample text',
  'response.font.pangram': 'Sphinx of black quartz, judge my vow',

  // ── Response · structured viewers ────────────────────────────────────────────
  'response.tree.aria': 'The response body as a tree',
  'response.tree.expand': 'Expand',
  'response.tree.collapse': 'Collapse',
  'response.tree.expandAll': 'Expand everything',
  'response.tree.collapseAll': 'Collapse everything',
  'response.tree.copyPath': 'Copy path',
  'response.tree.nodes': '{count} nodes',
  'response.csv.caption': 'The response body as a table',
  'response.csv.line': '#',
  'response.csv.rows.one': '{count} row',
  'response.csv.rows.other': '{count} rows',
  'response.csv.columns.one': '{count} column',
  'response.csv.columns.other': '{count} columns',
  'response.csv.delimiter': 'Separated by {delimiter}',
  'response.csv.ragged': 'Some rows carry a different number of values than the header.',
  'response.csv.truncated': 'Showing the first {shown} of {total} rows.',
  'response.sse.events.one': '{count} event',
  'response.sse.events.other': '{count} events',
  'response.sse.id': 'id {id}',
  'response.sse.retry': 'retry {ms} ms',
  'response.html.title': 'The page returned by this request',
  'response.html.sandboxed': 'Rendered without scripts, and without loading anything the page links to — you are seeing the document, not the assembled page.',
  'response.markdown.title': 'The document returned by this request',
  'response.archive.caption': 'The contents of the archive',
  'response.archive.entries.one': '{count} file',
  'response.archive.entries.other': '{count} files',
  'response.archive.sizes': '{packed} packed · {unpacked} unpacked',
  'response.archive.name': 'Name',
  'response.archive.size': 'Size',
  'response.archive.packed': 'Packed',
  'response.archive.modified': 'Modified',
  'response.noContent.title': '204 No Content',
  'response.noContent.desc': 'The server answered without a body, by design.',
  'response.emptyBody.title': 'Empty body',
  'response.emptyBody.desc': 'The response arrived with nothing in it.',
  // ── Response · timeline ──────────────────────────────────────────────────────
  // The phase names are the ones every network panel uses, so they stay recognisable
  // between tools. TTFB here is the wait *after* the connection is ready, which is
  // what makes the five bars partition the total instead of overlapping.
  'response.timeline.dns': 'DNS',
  'response.timeline.connect': 'Connect',
  'response.timeline.tls': 'TLS',
  'response.timeline.ttfb': 'Waiting',
  'response.timeline.download': 'Download',
  'response.timeline.absent': 'did not happen',
  'response.timeline.total': 'Total',
  'response.timeline.reused.desc': 'This request went out over a connection that was already open, so there was nothing to resolve, dial or negotiate.',
  'response.timeline.redirects.one': '{count} redirect followed',
  'response.timeline.redirects.other': '{count} redirects followed',
  'response.timeline.final': 'Final',
  // The two ways a chain ends without a final response. Distinct because the same URL
  // means different things: one 3xx arrived and was refused, the other was requested and
  // never answered.
  'response.timeline.notFollowed': 'Not followed',
  'response.timeline.unreached': 'No response',
  'response.timeline.security': 'Connection',
  'response.timeline.noTls': 'Sent over plain HTTP — nothing about this exchange was encrypted.',
  'response.timeline.resumed': 'resumed',
  // The values beside these are protocol tokens — TLS 1.3, h2, the cipher suite name —
  // so only the labels are translated.
  'response.timeline.tlsVersion': 'Protocol',
  'response.timeline.cipher': 'Cipher',
  'response.timeline.alpn': 'ALPN',
  'response.timeline.subject': 'Certificate',
  'response.timeline.issuer': 'Issued by',
  'response.timeline.validUntil': 'Valid until',
  'response.timeline.covers': 'Covers {names}',
  'response.timeline.andMore': ' and {count} more',

  'response.cookies.caption': 'The cookies this response set',
  'response.cookies.name': 'Name',
  'response.cookies.value': 'Value',
  'response.cookies.scope': 'Scope',
  'response.cookies.expires': 'Expires',
  'response.cookies.flags': 'Flags',
  'response.cookies.session': 'session',
  // The mark itself is the attribute name as the header spells it — a token, like the
  // format badges — so only the explanation around it is translated.
  'response.cookies.flag': '{flag} attribute',
  'response.cookies.none.title': 'No cookies',
  'response.cookies.none.desc': 'This response set none. Cookies appear here when the server sends a Set-Cookie header.',
  'response.headers.caption': 'Response headers',
  'response.headers.name': 'Name',
  'response.headers.value': 'Value',

  // ── Code view ────────────────────────────────────────────────────────────────
  // The target names — curl, HTTPie, Python · requests — are not here on purpose.
  // They are product and library names, and they sit with the HTTP methods and the
  // format badges on the list of things this app does not translate.
  'code.title': 'Code',
  'code.target': 'Language',
  'code.copy.aria': 'Copy snippet',
  'code.copied.aria': 'Snippet copied',
  'code.copy.title': 'Copy',
  'code.copied.live': 'Copied to clipboard',
  'code.copyFailed.live': 'Could not copy — clipboard access was denied',
  'code.close': 'Close code view',
  // Labelled by state rather than by action, and paired with an icon, so "is it on?"
  // never rests on telling one accent colour from a grey border.
  'code.redact.off': 'Secrets shown',
  'code.redact.on': 'Secrets hidden',
  'code.redact.desc': 'Replace tokens, passwords and API keys with an environment variable, so the snippet is safe to paste into a ticket.',

  // ── Tree row actions ─────────────────────────────────────────────────────────
  // The aria/title pair differs on purpose: the accessible name takes the bare name,
  // the tooltip wraps it in typographic quotes.
  'tree.actions': 'Actions for {name}',
  'tree.newRequestIn.aria': 'New request in {name}',
  'tree.newRequestIn.title': 'New request in “{name}”',
  'tree.newFolderIn.aria': 'New folder in {name}',
  'tree.newFolderIn.title': 'New folder in “{name}”',
  'tree.rename.aria': 'Rename {name}',
  'tree.rename.title': 'Rename “{name}”',
  'tree.delete.aria': 'Delete {name}',
  'tree.delete.title': 'Delete “{name}”',
  // Four whole questions rather than a spliced clause. Neither en nor es has a CLDR
  // `zero` category, so an empty container gets its own message instead of going
  // through the plural with a count of 0.
  //
  // The consequence moved out into `.detail` when these stopped being `window.confirm`
  // strings: the dialog has a title and a body, and a question that answers itself in
  // the same breath reads as one long line in the first of them.
  'tree.confirm.request': 'Delete “{name}”?',
  'tree.confirm.empty': 'Delete “{name}”?',
  'tree.confirm.container.one': 'Delete “{name}” and the {count} request inside it?',
  'tree.confirm.container.other': 'Delete “{name}” and the {count} requests inside it?',
  'tree.confirm.detail': 'This cannot be undone.',
  'tree.confirm.action': 'Delete',

  // ── Confirmations ─────────────────────────────────────────────────────────
  // The one label the dialog owns whatever it is asking: every intent names its own
  // confirm button, and none of them names this one differently.
  'confirm.cancel': 'Cancel',

  // ── Command palette ──────────────────────────────────────────────────────────
  'palette.dialog': 'Command palette',
  'palette.input.aria': 'Search requests and commands',
  'palette.input.placeholder': 'Search requests, or type > for commands…',
  'palette.results': 'Results',
  'palette.empty': 'No matches for “{query}”',
  'palette.footer.navigate': 'navigate',
  'palette.footer.run': 'run',
  'palette.footer.commands': 'commands',
  'palette.count.one': '{count} result',
  'palette.count.other': '{count} results',
  'palette.group.navigation': 'Open tabs',
  'palette.group.action': 'Actions',
  'palette.group.request': 'Requests',
  'palette.group.method': 'Change method',

  // ── Commands ─────────────────────────────────────────────────────────────────
  // `.keywords` is a hidden haystack for `fuzzyScore`, never rendered. The Spanish
  // catalogue keeps the English synonyms alongside its own: developers type `send`
  // and `save` from muscle memory whatever the UI language is.
  'command.newRequest.title': 'New request',
  'command.newRequest.keywords': 'create add request',
  'command.newFolder.title': 'New folder',
  'command.newFolder.keywords': 'create add folder group',
  'command.newCollection.title': 'New collection',
  'command.newCollection.keywords': 'create add collection',
  'command.cancel.title': 'Cancel request',
  'command.cancel.keywords': 'stop abort halt',
  'command.send.title': 'Send request',
  'command.send.keywords': 'run execute fire',
  'command.save.title': 'Save now',
  'command.save.keywords': 'persist store write flush disk',
  'command.close.title': 'Close tab',
  'command.close.keywords': 'dismiss hide',
  'command.reveal.title': 'Reveal in sidebar',
  'command.reveal.keywords': 'find locate show tree',
  'command.copyUrl.title': 'Copy request URL',
  'command.copyUrl.keywords': 'clipboard link',
  'command.code.title': 'Show code',
  'command.code.keywords': 'curl snippet generate export raw http fetch python go language',
  'command.copyCurl.title': 'Copy as curl',
  'command.copyCurl.keywords': 'clipboard curl snippet shell terminal',
  'command.findInResponse.title': 'Find in response',
  'command.findInResponse.keywords': 'search filter locate',
  'command.saveBody.title': 'Save response body…',
  'command.saveBody.keywords': 'download export write file disk',
  'command.copyBody.title': 'Copy response body',
  'command.copyBody.keywords': 'clipboard json',
  'command.clearResponse.title': 'Clear response',
  'command.clearResponse.keywords': 'reset dismiss',
  'command.retry.title': 'Retry request',
  'command.retry.keywords': 'again resend',
  'command.toggleSidebar.title': 'Toggle sidebar',
  'command.toggleSidebar.keywords': 'hide show collapse panel',
  'command.toggleSplit.title': 'Toggle split orientation',
  'command.toggleSplit.keywords': 'layout columns rows side by side stacked',
  'command.zoomIn.title': 'Zoom in',
  'command.zoomIn.keywords': 'zoom in bigger larger scale text size',
  'command.zoomOut.title': 'Zoom out',
  'command.zoomOut.keywords': 'zoom out smaller scale text size',
  'command.zoomReset.title': 'Reset zoom',
  'command.zoomReset.keywords': 'zoom reset actual size 100',
  'command.settings.title': 'Open settings',
  'command.settings.keywords': 'preferences options theme appearance dark light storage language',
  'command.exportWorkspace.title': 'Export configuration',
  'command.exportWorkspace.keywords': 'export backup save workspace collections file download share',
  'command.importWorkspace.title': 'Import configuration',
  'command.importWorkspace.keywords': 'import restore load workspace collections file open replace',
  'command.setMethod.title': 'Set method to {method}',
  'command.setMethod.keywords': 'method {method}',

  // ── Failure copy ─────────────────────────────────────────────────────────────
  // Resolved from the code at render time, so switching language retranslates a
  // failure that is already on screen. The redirect limit and the dev command are
  // params rather than catalogue text: a translator cannot mistype what they never see.
  'error.INVALID_URL.title': 'Invalid URL',
  'error.INVALID_URL.detail': 'Enter a complete URL beginning with http:// or https://.',
  'error.TIMEOUT.title': 'Request timed out',
  'error.TIMEOUT.detail': 'No response arrived in time. The server may be slow or unreachable.',
  'error.DNS_ERROR.title': 'Host not found',
  'error.DNS_ERROR.detail': 'That hostname could not be resolved. Check it for typos.',
  'error.CONNECTION_REFUSED.title': 'Connection refused',
  'error.CONNECTION_REFUSED.detail': 'Nothing is listening on that host and port.',
  'error.TLS_ERROR.title': 'Certificate not trusted',
  'error.TLS_ERROR.detail': 'The TLS certificate could not be verified. Check the host, or use http:// if this is a local server.',
  'error.TOO_MANY_REDIRECTS.title': 'Too many redirects',
  'error.TOO_MANY_REDIRECTS.detail': 'The server redirected more than {limit} times. Check the URL and any auth you are sending.',
  'error.NETWORK_ERROR.title': 'Network error',
  'error.NETWORK_ERROR.detail': 'The connection failed before a response arrived. Check the host, the port and your network.',
  'error.BACKEND_UNAVAILABLE.title': 'Desktop backend unavailable',
  'error.BACKEND_UNAVAILABLE.detail': 'Requests are sent by the HTTiny app itself. Run `{command}` — the browser dev server has no network layer.',
  'error.FILE_UNREADABLE.title': 'Attachment could not be read',
  'error.FILE_UNREADABLE.detail': 'One of the files attached to this body is missing or cannot be opened. Pick it again in the Body tab.',
  'error.BODY_TOO_LARGE.title': 'Body too large',
  'error.BODY_TOO_LARGE.detail': 'The request body is over the {limit} MB limit. HTTiny holds an outgoing body in memory so it can be resent across a redirect.',
  'error.UNKNOWN.title': 'Request failed',
  'error.UNKNOWN.detail': 'Something went wrong before a response arrived.',

  // ── Import and export ────────────────────────────────────────────────────────
  //
  // Its own block rather than more `settings.*`: three surfaces raise these — the Storage
  // panel, the sidebar's empty state and the command palette — so the copy cannot belong
  // to any one of them.
  'transfer.export.dialog': 'Export HTTiny configuration',
  'transfer.import.dialog': 'Import HTTiny configuration',
  'transfer.reject.malformed': 'This is not an HTTiny export, or the file is damaged.',
  'transfer.reject.newerApp': 'This file was written by a newer version of HTTiny. Update, then import it.',
  // Distinct from the one above on purpose: the envelope was understood and the workspace
  // inside it was not, which is a different thing to have gone wrong and a different fix.
  'transfer.reject.newerWorkspace': 'This file holds a workspace from a newer version of HTTiny. Update, then import it.',
  'transfer.reject.unreadable': 'The file could not be opened.',
  'transfer.confirm.title.empty': 'Replace this workspace with an empty one?',
  'transfer.confirm.title.one': 'Replace this workspace with the {count} collection in the file?',
  'transfer.confirm.title.other': 'Replace this workspace with the {count} collections in the file?',
  'transfer.confirm.detail': 'Every collection, request and environment here is replaced, and the interface settings follow the file too.',
  // Only when the file actually carries credentials. Saying it unconditionally would
  // teach people to ignore it.
  'transfer.confirm.detail.secrets': 'The file carries credentials, which replace the ones stored for this workspace.',
  // Said only in the state where it is true — a read that failed earlier switches the
  // destructive half of the credential save off for the whole session.
  'transfer.confirm.detail.stranded': 'The credential store could not be read this session, so the tokens being replaced cannot be removed from it.',
  'transfer.confirm.action': 'Replace workspace',

  // ── Settings ─────────────────────────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.sections': 'Settings sections',
  // The tab labels double as the heading of their panel, which is why no panel prints one.
  'settings.section.general': 'General',
  'settings.section.appearance': 'Appearance',
  'settings.section.layout': 'Layout',
  'settings.section.storage': 'Storage',
  'settings.close': 'Close settings',
  // Short, because the navigation column is 176px wide. The sentence that has to carry the
  // whole meaning lives in the confirmation, where there is room for it.
  'settings.reset.label': 'Restore defaults',
  // The question, then what it costs — and what it does not. Nobody restoring a
  // preference should have to wonder whether their requests went with it.
  'settings.reset.confirm': 'Restore every setting to its default?',
  'settings.reset.detail': 'This includes the interface language. Nothing in your workspace changes.',
  'settings.storage.export.label': 'Export configuration',
  'settings.storage.export.desc': 'Write your collections, environments and interface preferences to a file you can keep or move to another machine.',
  // Not "Export": the row above it already says that, so the button would only repeat
  // its own label. It names the next step instead, the way `editor.body.file.choose`
  // does for the attachment picker.
  'settings.storage.export.action': 'Save file',
  'settings.storage.export.saved': 'Saved',
  'settings.storage.export.failed': 'Could not save',
  'settings.storage.secrets.label': 'Include secrets',
  // Two descriptions rather than one with a warning bolted on, because the two states are
  // genuinely different files. Off is the promise `workspace.json` already keeps.
  'settings.storage.secrets.desc.off': 'Tokens, passwords and locked variables stay in the credential store. The file is safe to copy, send or attach to a bug report.',
  'settings.storage.secrets.desc.on': 'Tokens, passwords and locked variables go into the file as plain text. Anyone who opens it can read them.',
  'settings.storage.import.label': 'Import configuration',
  'settings.storage.import.desc': 'Read a file exported from HTTiny. It replaces every collection, request and environment in this workspace.',
  'settings.storage.import.action': 'Choose file',
  'settings.storage.location.label': 'Where it is stored',
  'settings.storage.location.desc': 'The folder holding workspace.json and ui.json.',
  'settings.storage.location.copy': 'Copy the folder path',
  'settings.storage.quarantine.label': 'Set aside on startup',
  // The one place this is ever said. Go names the file it moved; without this the user
  // sees an empty workspace and a healthy-looking footer.
  'settings.storage.quarantine.desc': 'A file could not be read and was moved aside rather than deleted, so this workspace started empty. The original is still there.',
  'settings.storage.unavailable.browser': 'Only the desktop app can read and write files.',
  'settings.storage.unavailable.newer': 'This workspace was written by a newer version of HTTiny and is read-only until you update.',
  'settings.theme.label': 'Theme',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  // Lower-case, for inside a sentence — the buttons above carry the capitalised
  // forms. Splicing the raw `'light'` / `'dark'` token in would read as "Siempre dark".
  'settings.theme.inline.light': 'light',
  'settings.theme.inline.dark': 'dark',
  'settings.theme.desc.system': 'Following the system, currently {theme}.',
  'settings.theme.desc.always': 'Always {theme}, whatever the system is set to.',
  'settings.zoom.label': 'Zoom',
  'settings.zoom.desc': 'Scales the whole interface.',
  // No space before the sign in English, one in Spanish — which is the whole reason this
  // is a message with a slot rather than a template in the component.
  'settings.zoom.value': '{zoom}%',
  'settings.zoom.in': 'Zoom in',
  'settings.zoom.out': 'Zoom out',
  'settings.zoom.reset': 'Reset zoom',
  'settings.codeFont.label': 'Code text size',
  'settings.codeFont.desc': 'The request and response bodies. The zoom applies on top of it.',
  'settings.codeFont.value': '{size}px',
  'settings.codeFont.in': 'Larger code text',
  'settings.codeFont.out': 'Smaller code text',
  'settings.codeFont.reset': 'Reset code text size',
  // A switch is labelled by what turning it *on* does, not by the name of the setting:
  // "Layout" beside a switch would not say which way is which. `rows` is the default, so
  // off is the factory state.
  'settings.layout.sideBySide.label': 'Side by side',
  'settings.layout.sideBySide.desc': 'Put the response beside the request instead of below it.',
  'settings.layout.sidebar.label': 'Sidebar width',
  'settings.layout.sidebar.desc': 'How much room the collections tree gets.',
  // The width stays adjustable while the sidebar is hidden — the drag handle is not
  // even mounted then, so this row is the only way to reach it. Without saying so the
  // slider would look broken.
  'settings.layout.sidebar.desc.collapsed': 'The sidebar is hidden — this applies when you show it again.',
  'settings.layout.sidebar.value': '{width} px',
  'settings.layout.split.label': 'Request and response',
  // Two variants because the ratio divides the height in `rows` and the width in
  // `columns`, the same distinction `app.resizeRows` / `app.resizeColumns` already make.
  'settings.layout.split.desc.rows': 'How the height is split between the request and the response.',
  'settings.layout.split.desc.columns': 'How the width is split between the request and the response.',
  'settings.layout.split.value': '{request} / {response}',
  // Echoes the viewer's own control (`response.interpretAs`) on purpose: it is the same
  // setting in two places, and reading it as two would be worse than the repetition.
  'settings.response.format.label': 'Interpret bodies as',
  'settings.response.format.desc':
    'What the viewer opens a body as. Automatic reads a JSON body as JSON even when the content type says otherwise, and a format picked in the viewer wins for that request.',
  'settings.response.format.auto': 'Automatic',
  // The durable half of the code view's switch, so the copy has to say that the switch
  // itself still wins for the visit — otherwise this reads as a lock rather than a default.
  'settings.code.redact.label': 'Hide secrets by default',
  'settings.code.redact.desc': 'The code view opens with tokens and passwords replaced by a placeholder. Its own switch still shows them for that visit.',
  'settings.language.label': 'Language',
  'settings.language.desc': 'Choose the interface language.',

  // ── Updates ──────────────────────────────────────────────────────────────────
  // The version is always a `{version}` parameter and never part of the message,
  // for the same reason the dev command is in `errors.ts`: a translator cannot
  // mistype a number they never see.
  'update.dialog': 'Update',
  'update.available.title': 'Update available',
  'update.available.body': 'HTTiny {version} is out. Installing takes a moment: the app closes, updates and opens again.',
  'update.available.action': 'Install and restart',
  'update.downloading.title': 'Downloading',
  'update.downloading.body': 'Fetching HTTiny {version}.',
  // Both sides are already formatted, so they arrive as strings — the units belong to
  // formatBytes, which follows the app's language rather than the system's.
  'update.progress': '{received} of {total}',
  'update.preparing.title': 'Preparing',
  'update.preparing.body': 'Verifying HTTiny {version} and getting it ready. The app will close and reopen on its own.',
  'update.manual.title': 'Update available',
  'update.manual.body': 'HTTiny {version} is out. This installation cannot update itself, so download the new version and install it the way you installed this one.',
  'update.manual.action': 'Download',
  'update.error.title': 'Could not update',
  'update.error.body': 'HTTiny {version} is out, but downloading it failed. You can get it from the releases page instead.',
  'update.notes': 'What changed',
  'update.later': 'Later',

  // ── Default names for new nodes ──────────────────────────────────────────────
  // Written into workspace.json as user data: switching language later does not
  // rename what already exists, because by then it is content and not copy.
  'data.newRequest': 'New Request',
  'data.newCollection': 'New Collection',
  'data.newFolder': 'New Folder',
  'data.myCollection': 'My Collection',
  'data.newEnvironment': 'New Environment',
  'data.copyOf': '{name} copy',
  // ── Environments ──────────────────────────────────────────────────────────────
  // Environment *names* are user data and are never translated, and neither is the `.env`
  // label on the picker's button — a filename is a technical token, like the HTTP methods.
  // These are the chrome around them. Sentence case throughout: `.kv-header` does its own
  // uppercasing in CSS, so no accent is lost to a hand-typed capital.
  'env.picker.aria': 'Environment for {name}',
  'env.picker.none': 'No environment',
  'env.manage.aria': 'Manage .env variables for {name}',
  'env.manage.title': 'Manage variables  {keys}',
  'env.title': 'Variables · {name}',
  'env.close': 'Close',
  'env.list': 'Environments',
  'env.new': 'New environment',
  'env.name': 'Environment name',
  'env.namePlaceholder': 'Staging',
  'env.activate': 'Activate',
  'env.active': 'Active',
  'env.duplicate': 'Duplicate environment',
  'env.delete': 'Delete environment',
  'env.count.one': '{count} variable',
  'env.count.other': '{count} variables',
  'env.confirm.title': 'Delete {name}?',
  // Says the part that is not obvious: this is the one delete that reaches past
  // workspace.json into the OS credential store.
  'env.confirm.detail': 'Its variables go with it, and any locked values are removed from the credential store. This cannot be undone.',
  'env.confirm.action': 'Delete',
  'env.empty.title': 'No variables in {name}',
  'env.empty.desc': 'Group the values that change between servers — a host, a tenant, a token — and write {example} in a URL, a header or a body. One pass: a variable inside a value is not expanded.',
  'env.empty.new': 'New environment',
  'env.var.add': 'Add variable',
  // The completion dropdown's right-hand column. A locked variable's value never appears
  // there — the marker is what says a value exists and is being withheld.
  'env.complete.secret': 'locked',
  'env.complete.empty': 'empty',
  'env.var.secret': 'Keep out of the workspace file',
  'env.var.secretNamed': 'Keep {name} out of the workspace file',
  'env.var.sessionOnly': 'No credential store is reachable, so locked values last for this session only and are lost on restart.',
  'command.environments.title': 'Manage variables',
  'command.environments.keywords': 'environment variables env vars secrets',
  'command.useEnvironment.title': 'Use {name}',
  'command.useEnvironment.keywords': 'environment use switch activate {name}',
  'command.noEnvironment.title': 'Use no environment',
  'command.noEnvironment.keywords': 'environment none off clear disable variables',
} as const
