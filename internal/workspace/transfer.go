package workspace

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Failure codes for moving a workspace in and out of a file the user picks. Stable
// tokens the frontend branches on, with their copy in frontend/src/errors.ts; a code
// added here without an entry there degrades to the generic message.
const (
	codeTransferUnavailable = "TRANSFER_UNAVAILABLE"
	codeTransferFailed      = "TRANSFER_FAILED"
	codeImportTooLarge      = "IMPORT_TOO_LARGE"
)

// The ceiling on a file this package will read into a string and hand across the
// binding.
//
// A fourth cap, and deliberately not a reuse of any of httpexec's three: those bound
// what a *response* may be (maxBodyBytes), what of it reaches a CodeMirror document
// (maxTextBytes), and what may be uploaded (maxUploadBytes). This one bounds what is
// parsed as JSON in the webview, which is a different question with a different answer —
// a workspace is text, and one this large is a mistake or an attack rather than
// somebody's collections.
const maxImportBytes = 32 << 20 // 32 MiB

// TransferResult reports an export.
//
// Cancelled is its own field rather than an error code, for the reason httpexec's
// SaveResult gives: dismissing a file dialog is the most ordinary thing a person can do
// with one, and the interface must not be able to render it as a failure.
type TransferResult struct {
	OK        bool `json:"ok"`
	Cancelled bool `json:"cancelled"`
	// Where it was written, so the UI can name the file it just produced.
	Path      string `json:"path"`
	ErrorCode string `json:"errorCode"`
	ErrorText string `json:"errorText"`
}

// ImportResult carries the file's text back for the frontend to validate.
//
// Contents and not a path: the frontend owns the payload schema, so it is the only side
// that can say whether these bytes are a workspace. Handing back a path instead would
// mean Go reading a file it cannot judge, or the webview holding a path it cannot open.
type ImportResult struct {
	OK        bool   `json:"ok"`
	Cancelled bool   `json:"cancelled"`
	Path      string `json:"path"`
	Contents  string `json:"contents"`
	ErrorCode string `json:"errorCode"`
	ErrorText string `json:"errorText"`
}

func transferFailed(code string, err error) TransferResult {
	text := ""
	if err != nil {
		text = err.Error()
	}
	return TransferResult{ErrorCode: code, ErrorText: text}
}

func importFailed(code string, err error) ImportResult {
	text := ""
	if err != nil {
		text = err.Error()
	}
	return ImportResult{ErrorCode: code, ErrorText: text}
}

// ExportFile writes an already-serialised workspace export to a file the user chooses.
//
// The dialog is opened here rather than from the frontend, although the Wails runtime
// offers both — the reason httpexec's SaveBody gives: going the other way means handing
// a filesystem path back across the binding for Go to write to, which is a wider door
// than this needs.
//
// Contents arrives serialised because the frontend owns the payload schema. Go neither
// builds nor validates it, exactly as it does not for workspace.json.
func (s *Service) ExportFile(_ context.Context, contents, filename, title string) TransferResult {
	// Resolved at call time, not construction time: the application does not exist when a
	// service is built.
	app := application.Get()
	if app == nil || app.Dialog == nil {
		return transferFailed(codeTransferUnavailable, errors.New("no file dialog is available"))
	}

	name := strings.TrimSpace(filename)
	if name == "" {
		name = "httiny-workspace.json"
	}

	// Every field is set because each platform reads a different subset: Windows honours
	// Title, Filters and Filename; macOS honours Message and the booleans but neither
	// Title nor Filters; Linux honours Title and Filters but not Filename.
	dialog := app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:                title,
		Message:              title,
		Filename:             name,
		Filters:              jsonFilters(),
		CanCreateDirectories: true,
	})

	path, err := dialog.PromptForSingleSelection()
	// An empty path means cancelled, whatever err says. Windows reports a dismissed dialog
	// *as an error* while macOS and Linux return an empty string and no error; keying on
	// the path is the only rule true on all three.
	if strings.TrimSpace(path) == "" {
		return TransferResult{Cancelled: true}
	}
	if err != nil {
		return transferFailed(codeTransferFailed, err)
	}

	// Written directly, not through this package's temp-and-rename. That dance protects
	// the app's own files in the app's own directory, where a stray .tmp is ours to clean
	// up; here the user picked the directory and leaving debris beside their file would be
	// the worse failure. It is also why the export carries its own version rather than
	// being wrapped in envelope — this is not one of our files.
	//
	// 0o600 because the export can carry credentials when the user opts in. Windows
	// ignores the mode, the same caveat ServiceStartup records for the data directory, so
	// the opt-in's copy has to say what is in the file rather than lean on this.
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		return transferFailed(codeTransferFailed, fmt.Errorf("write %s: %w", filepath.Base(path), err))
	}
	return TransferResult{OK: true, Path: path}
}

// ImportFile opens a workspace export the user chooses and hands back its text.
func (s *Service) ImportFile(_ context.Context, title string) ImportResult {
	app := application.Get()
	if app == nil || app.Dialog == nil {
		return importFailed(codeTransferUnavailable, errors.New("no file dialog is available"))
	}

	dialog := app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:                   title,
		Message:                 title,
		Filters:                 jsonFilters(),
		CanChooseFiles:          true,
		CanChooseDirectories:    false,
		AllowsMultipleSelection: false,
		ResolvesAliases:         true,
	})

	path, err := dialog.PromptForSingleSelection()
	// The cancellation rule above, from the other direction.
	if strings.TrimSpace(path) == "" {
		return ImportResult{Cancelled: true}
	}
	if err != nil {
		return importFailed(codeTransferFailed, err)
	}

	contents, err := readCapped(path)
	if err != nil {
		if errors.Is(err, errTooLarge) {
			return importFailed(codeImportTooLarge, err)
		}
		return importFailed(codeTransferFailed, err)
	}
	return ImportResult{OK: true, Path: path, Contents: contents}
}

var errTooLarge = errors.New("file is too large to import")

// readCapped reads at most maxImportBytes and refuses anything longer.
//
// One byte past the cap is read on purpose: os.Stat would answer the same question a beat
// earlier, but a file can grow between the stat and the read, and the point of the cap is
// what ends up in memory rather than what was on disk a moment ago.
func readCapped(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", filepath.Base(path), err)
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxImportBytes+1))
	if err != nil {
		return "", fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	if len(data) > maxImportBytes {
		return "", fmt.Errorf("%s is over the %d MiB limit: %w", filepath.Base(path), maxImportBytes>>20, errTooLarge)
	}
	return string(data), nil
}

// jsonFilters offers the export's own kind first and "all files" second.
//
// Order matters beyond presentation: on Windows the first filter's first pattern is what
// supplies the extension appended to a name typed without one. The display name is built
// from the extension rather than translated, for the reason format badges are not
// translated either — it is a token, not prose.
func jsonFilters() []application.FileFilter {
	return []application.FileFilter{
		{DisplayName: "JSON (*.json)", Pattern: "*.json"},
		{DisplayName: "All files (*.*)", Pattern: "*.*"},
	}
}
