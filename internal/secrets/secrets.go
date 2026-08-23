// Package secrets keeps request credentials in the operating system's credential
// store instead of in the workspace file.
//
// Bearer tokens and basic-auth passwords are credentials for the *user's* APIs. In
// a plaintext JSON file they would be readable by anything running as the user, and
// %AppData%\Roaming — the natural home for the workspace on Windows — is exactly
// what roaming profiles and file-sync clients replicate. Keeping them here also
// means the workspace file stays safe to copy, diff, commit and attach to a bug
// report, and that the .bak and quarantine copies never contain a secret either.
package secrets

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"

	"github.com/zalando/go-keyring"
)

// service is the credential-store bucket. On Windows it becomes the target name
// prefix in Credential Manager, on macOS the Keychain service, on Linux the
// secret-service collection attribute.
const service = "HTTiny"

// probeKey is looked up — never written — to decide whether a credential store
// exists at all. A read of a missing key is the cheapest non-destructive probe.
const probeKey = "__httiny_probe__"

// maxSecretBytes is the Windows Credential Manager blob limit
// (CRED_MAX_CREDENTIAL_BLOB_SIZE). Exceeding it fails deep inside wincred with an
// opaque error, so it is checked here where the message can name the cause.
const maxSecretBytes = 2560

// Entry is the credential pair for one request. `username` is deliberately absent:
// it is an identifier, not a secret, and it stays in the workspace file so the auth
// panel can show who you are authenticating as without unlocking anything.
type Entry struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

// Empty reports whether there is nothing worth storing, in which case the caller
// should delete any existing entry rather than write a blank one.
func (e Entry) Empty() bool { return e.Token == "" && e.Password == "" }

// reachable latches a successful probe. See Available.
var reachable atomic.Bool

// Available reports whether a credential store can be reached.
//
// This is not a given: on Linux go-keyring talks to the D-Bus Secret Service, and a
// headless box or a desktop without gnome-keyring/KWallet simply has none. Callers
// are expected to degrade — keep secrets in memory for the session — rather than
// fail the whole workspace load.
//
// The probe is a full credential-store read, and it is paid on every LoadSecrets *and*
// every SaveSecrets. On macOS that is a fork of /usr/bin/security before any work
// happens, so a debounced credential write cost an extra process every time. A store
// that has answered once does not go away for the life of the process, so a positive
// answer is latched.
//
// The negative deliberately is not. A Linux session whose keyring is unlocked after
// launch has to be able to start persisting credentials, and the sidebar footer's
// "session-only" warning has to be able to go away again — a sync.Once would freeze it
// on for the session, which is the one behaviour this must not change.
func Available() bool {
	if reachable.Load() {
		return true
	}
	_, err := keyring.Get(service, probeKey)
	if err == nil || errors.Is(err, keyring.ErrNotFound) {
		reachable.Store(true)
		return true
	}
	return false
}

// Set stores one request's credentials, or removes them when the entry is empty so
// clearing a token in the UI does not leave the old one behind in the keychain.
func Set(id string, entry Entry) error {
	if entry.Empty() {
		return Delete(id)
	}
	encoded, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("encode secret for %q: %w", id, err)
	}
	if len(encoded) > maxSecretBytes {
		return fmt.Errorf("secret for %q is %d bytes, over the %d-byte credential store limit", id, len(encoded), maxSecretBytes)
	}
	if err := keyring.Set(service, id, string(encoded)); err != nil {
		return fmt.Errorf("store secret for %q: %w", id, err)
	}
	return nil
}

// Get returns the stored credentials. A missing entry is not an error: it is the
// normal state for a request that has never had auth, and for every request when
// the workspace was written on a machine whose keychain this is not.
func Get(id string) (Entry, error) {
	raw, err := keyring.Get(service, id)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return Entry{}, nil
		}
		return Entry{}, fmt.Errorf("read secret for %q: %w", id, err)
	}
	var entry Entry
	if err := json.Unmarshal([]byte(raw), &entry); err != nil {
		// Someone else wrote this key, or an older format did. Treat it as absent
		// rather than failing the load of an otherwise good workspace.
		return Entry{}, nil
	}
	return entry, nil
}

// Delete removes a request's credentials, treating "already gone" as success so
// deleting a request twice is not an error.
func Delete(id string) error {
	if err := keyring.Delete(service, id); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("delete secret for %q: %w", id, err)
	}
	return nil
}
