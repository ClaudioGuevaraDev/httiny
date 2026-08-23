// Package workspace persists the user's collections and session to disk.
//
// The frontend owns the payload schema; this package owns the envelope, atomic
// writes, and recovery. That split is deliberate: a Go mirror of RequestDocument
// would be a second definition of the same shape, drifting out of sync with nothing
// in a test-free project to catch it.
package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ClaudioGuevaraDev/httiny/internal/secrets"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	dirName = "HTTiny"
	// Two files, not one. They differ on portability (collections travel between
	// machines, a window layout should not), on write cadence (dragging the split
	// handle must not rewrite the file holding your requests), and on blast radius
	// (a corrupt layout should never cost you your work).
	workspaceFile = "workspace.json"
	prefsFile     = "ui.json"
	// Overrides the data directory, so `wails3 task dev` need not write over a real
	// workspace.
	dirEnvVar = "HTTINY_DATA_DIR"
)

// envelope is the whole of Go's understanding of a file. Payload stays raw so the
// schema can change with the frontend alone.
type envelope struct {
	Version int             `json:"version"`
	SavedAt string          `json:"savedAt"`
	Payload json.RawMessage `json:"payload"`
}

// LoadResult crosses the binding. Payload is the payload's JSON *text*; the
// frontend parses and validates it.
type LoadResult struct {
	Found   bool   `json:"found"`
	Version int    `json:"version"`
	Payload string `json:"payload"`
	// Set when an unreadable file was moved aside, so the UI can say where it went.
	Quarantined string `json:"quarantined"`
}

// Secret is one request's credentials as they cross the binding.
type Secret struct {
	ID       string `json:"id"`
	Token    string `json:"token"`
	Password string `json:"password"`
}

// SecretsResult reports whether the credential store could be used at all, so the
// UI can tell the user their tokens are session-only instead of silently losing
// them. Failing to reach a keychain must never fail the workspace load.
type SecretsResult struct {
	Available bool     `json:"available"`
	Secrets   []Secret `json:"secrets"`
	Error     string   `json:"error"`
}

type Service struct {
	dir string
	mu  sync.Mutex
}

func New() *Service { return &Service{} }

func (s *Service) ServiceName() string { return "Workspace" }

func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	dir := os.Getenv(dirEnvVar)
	if dir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return fmt.Errorf("locate the user config directory: %w", err)
		}
		dir = filepath.Join(base, dirName)
	}
	// 0o700 so other users on the machine cannot read the workspace. Windows
	// ignores the mode; there the protection is the per-user ACL already on
	// %AppData%. Credentials are not in these files either way — see internal/secrets.
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create the data directory %q: %w", dir, err)
	}
	s.dir = dir
	return nil
}

// ServiceShutdown cannot flush anything: the pending payload lives in the frontend,
// never here. Taking the lock makes shutdown wait for an in-flight rename instead of
// racing it and leaving a stray .tmp behind.
func (s *Service) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return nil
}

// DataDir lets the UI tell the user where their collections actually live.
func (s *Service) DataDir(_ context.Context) string { return s.dir }

func (s *Service) LoadWorkspace(_ context.Context) (LoadResult, error) { return s.load(workspaceFile) }

func (s *Service) LoadPrefs(_ context.Context) (LoadResult, error) { return s.load(prefsFile) }

func (s *Service) SaveWorkspace(_ context.Context, payload string, version int) error {
	return s.save(workspaceFile, payload, version)
}

func (s *Service) SavePrefs(_ context.Context, payload string, version int) error {
	return s.save(prefsFile, payload, version)
}

// secretWorkers bounds the fan-out of the two credential loops below.
//
// One credential-store read is 50-300us on Windows (a single CredReadW), but on macOS
// go-keyring forks /usr/bin/security per credential at 15-40ms each, and on Linux it
// opens a fresh D-Bus connection and makes five round trips. A workspace where a hundred
// requests carry a bearer token therefore cost between fifteen milliseconds and four
// seconds of blocked first paint depending on the platform. Eight is enough to hide that
// without opening a hundred D-Bus connections at once.
//
// Concurrency is safe on all three: the Windows backend is a bare syscall, the macOS one
// an exec, and the Linux one builds its own connection inside every call, so no two
// goroutines share anything.
const secretWorkers = 8

// eachIndex runs fn over 0..n on a bounded pool, in no particular order. Callers write
// their results into a slice indexed by position and read it only after this returns, so
// they can reassemble in the order they asked for and error semantics do not depend on
// scheduling.
func eachIndex(n int, fn func(index int)) {
	workers := secretWorkers
	if n < workers {
		workers = n
	}
	var next atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				at := int(next.Add(1)) - 1
				if at >= n {
					return
				}
				fn(at)
			}
		}()
	}
	wg.Wait()
}

// lastError reports the last non-nil error in index order, which is the answer a
// sequential loop assigning to one variable would have given.
func lastError(errs []error) string {
	out := ""
	for _, err := range errs {
		if err != nil {
			out = err.Error()
		}
	}
	return out
}

// LoadSecrets fetches credentials for the given request ids in one call rather than
// one round trip each, which matters because this sits on the startup path.
//
// The reads run concurrently but are assembled in the caller's order, and the last error
// in that order still wins — the same answer the sequential loop gave, so nothing
// downstream can tell the difference.
func (s *Service) LoadSecrets(_ context.Context, ids []string) SecretsResult {
	if !secrets.Available() {
		return SecretsResult{Error: "no credential store is available on this system"}
	}
	type slot struct {
		entry secrets.Entry
		err   error
	}
	// Each slot is written by exactly one goroutine and read only after eachSecret
	// returns, so there is nothing to synchronise beyond the WaitGroup inside it.
	slots := make([]slot, len(ids))
	eachIndex(len(ids), func(index int) {
		slots[index].entry, slots[index].err = secrets.Get(ids[index])
	})

	out := SecretsResult{Available: true, Secrets: make([]Secret, 0, len(ids))}
	for i, got := range slots {
		if got.err != nil {
			// One unreadable entry must not cost the others.
			out.Error = got.err.Error()
			continue
		}
		if got.entry.Empty() {
			continue
		}
		out.Secrets = append(out.Secrets, Secret{ID: ids[i], Token: got.entry.Token, Password: got.entry.Password})
	}
	return out
}

// SaveSecrets writes the given credentials and removes every stored entry whose id
// is not in `keep`, so deleting a request or clearing its token also clears the
// keychain. `keep` is the full set of live request ids.
func (s *Service) SaveSecrets(_ context.Context, entries []Secret, keep []string) SecretsResult {
	if !secrets.Available() {
		return SecretsResult{Error: "no credential store is available on this system"}
	}
	out := SecretsResult{Available: true}

	// Built before anything is written, because the sweep below reads it: the two passes
	// were sequential loops and this keeps them ordered against each other even though
	// each is now concurrent within itself.
	written := make(map[string]bool, len(entries))
	for _, entry := range entries {
		written[entry.ID] = true
	}

	writeErrs := make([]error, len(entries))
	eachIndex(len(entries), func(index int) {
		entry := entries[index]
		writeErrs[index] = secrets.Set(entry.ID, secrets.Entry{Token: entry.Token, Password: entry.Password})
	})

	sweepErrs := make([]error, len(keep))
	eachIndex(len(keep), func(index int) {
		if written[keep[index]] {
			return
		}
		sweepErrs[index] = secrets.Delete(keep[index])
	})

	// The sweep runs second and so wins ties, which is the order the two sequential loops
	// assigned in.
	if message := lastError(writeErrs); message != "" {
		out.Error = message
	}
	if message := lastError(sweepErrs); message != "" {
		out.Error = message
	}
	return out
}

func (s *Service) load(name string) (LoadResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.dir, name)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return LoadResult{Found: false}, nil // first run
	}
	if err != nil {
		return LoadResult{}, fmt.Errorf("read %s: %w", name, err)
	}

	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil || len(env.Payload) == 0 {
		// Still the user's data — most likely a hand edit with a trailing comma.
		// Move it aside so the next autosave cannot overwrite it, and start clean.
		moved, moveErr := s.quarantine(name)
		if moveErr != nil {
			return LoadResult{}, fmt.Errorf("set aside the unreadable %s: %w", name, moveErr)
		}
		return LoadResult{Found: false, Quarantined: moved}, nil
	}

	// One known-good snapshot per session, taken before any write can touch the
	// live file. Copying on every save would be pointless churn.
	_ = os.WriteFile(path+".bak", raw, 0o600)

	return LoadResult{Found: true, Version: env.Version, Payload: string(env.Payload)}, nil
}

func (s *Service) quarantine(name string) (string, error) {
	stamp := time.Now().UTC().Format("20060102-150405")
	target := filepath.Join(s.dir, fmt.Sprintf("%s.corrupt-%s", name, stamp))
	if err := os.Rename(filepath.Join(s.dir, name), target); err != nil {
		return "", err
	}
	return target, nil
}

func (s *Service) save(name, payload string, version int) error {
	if !json.Valid([]byte(payload)) {
		return errors.New("the payload is not valid JSON")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	env := envelope{
		Version: version,
		SavedAt: time.Now().UTC().Format(time.RFC3339),
		Payload: json.RawMessage(payload),
	}
	// Indented because the file is meant to be readable, diffable and hand-editable.
	// RawMessage preserves the frontend's field order, which a map round-trip would
	// replace with alphabetical.
	out, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return fmt.Errorf("encode %s: %w", name, err)
	}

	// Same directory, so the rename stays on one filesystem and is therefore atomic.
	tmp, err := os.CreateTemp(s.dir, name+".*.tmp")
	if err != nil {
		return fmt.Errorf("create a temporary file for %s: %w", name, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // a no-op once the rename succeeds

	if _, err := tmp.Write(out); err != nil {
		tmp.Close()
		return fmt.Errorf("write %s: %w", name, err)
	}
	// Sync before rename: without it a power loss can leave a renamed but empty file,
	// which is a worse outcome than the crash itself.
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("flush %s: %w", name, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close %s: %w", name, err)
	}

	return replace(tmpName, filepath.Join(s.dir, name))
}

// replace renames over an existing file. That is atomic on all three platforms, but
// on Windows it can fail with a sharing violation when an antivirus scanner or an
// editor briefly holds the destination open; one retry clears it in practice.
func replace(from, to string) error {
	err := os.Rename(from, to)
	if err == nil {
		return nil
	}
	time.Sleep(50 * time.Millisecond)
	if err := os.Rename(from, to); err != nil {
		return fmt.Errorf("replace %s: %w", to, err)
	}
	return nil
}
