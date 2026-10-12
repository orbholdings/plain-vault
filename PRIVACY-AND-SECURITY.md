# Plain Vault 0.1.0

This is a first testing release. It has not received an independent security
audit, and real-device Windows/Android validation is still required. Test with
dummy credentials before entrusting sensitive accounts to it.

## What is stored and transmitted

- Vaults use KeePass KDBX 4 with AES-256 encryption, HMAC-SHA-256 authentication
  and Argon2id (64 MiB, three passes, one lane) for new vaults.
- The master password is used on the device and is never transmitted by sync.
- The vault, password history and prior-vault backups are encrypted files.
- Device pairing metadata is protected with Android Keystore AES-GCM on the
  phone and Electron safeStorage/Windows DPAPI on Windows. The PC's TLS key is
  also protected by Windows DPAPI.
- Wi-Fi sync uses HTTPS/TLS 1.2+ with the PC certificate fingerprint pinned by
  the phone. Pairing codes contain an address, certificate fingerprint and a
  256-bit token, expire within five minutes and can be redeemed once.
- Persistent sync tokens can be revoked from the PC's paired-device list.
- Sync destinations are numeric private IPv4 addresses. Public destinations,
  redirects and arbitrary renderer network requests are blocked.
- The PC binds port 48521 only while you start local sync and keep its vault
  unlocked. Incoming clients require a paired-device token. The listener shuts
  down on lock, minimise, OS lock/suspend or app exit.
- There is no account registration, analytics, advertising, remote icon lookup,
  cloud sync, automatic update service or internet leak/breach lookup.
- The optional support button opens https://square.link/u/kAddgU4q in the system
  browser after a click. That external service has its own privacy practices.

## Application boundaries

The Android app renders bundled assets in a WebView with a fixed HTTPS origin;
file/content access, arbitrary navigation, remote loading and debugging are
disabled. Native operations are limited to the vault, backups, clipboard,
system file picker and the pinned local-sync connection. Camera access is
requested only for the QR scan. Screen capture and Android OS backups are
disabled. Import/export uses the scoped system file picker without broad file
permissions. The vault is locked before opening that picker.

The desktop renderer is sandboxed with Node integration disabled and context
isolation enabled. A narrow IPC bridge exposes the same operations. It only
loads bundled files; arbitrary navigation, embedded frames and network requests
are blocked. Spell checking and Chromium background networking/component updates
are disabled. The crypto and UI code never use localStorage for secrets.

Passwords use protected buffers in the KDBX engine. Lock clears those buffers
and removes secret-containing UI. JavaScript strings, browser/OS memory and
the WebAssembly runtime cannot be guaranteed to be completely wiped. A
compromised unlocked operating system or malware with clipboard/keylogging
access remains outside this app's protection.

## Data consistency and recovery

The PC is the central sync replica. Each phone submits an encrypted local vault;
the unlocked PC decrypts/merges and atomically saves it, then returns an encrypted
merged vault. The phone merges and saves the response. A dropped response leaves
the original phone copy intact and can be retried. Unrelated vault UUIDs are
rejected. Concurrent changes are preserved in password history. Whole-second
monotonic edit/location timestamps avoid losing rapid edits to KDBX timestamp
precision. Equal-time differing edits receive explicit history preservation.

Writes check the previous ciphertext revision and back up the prior file before
replacement. Windows uses a flushed temporary file and rename; Android uses
AtomicFile. The newest ten backups are retained. Backup write failure prevents
replacement, and a failed save rolls back the in-memory edit. A local backup
is not an off-device backup: export regularly.

History is deliberately not pruned in this release. Vaults are limited to 16 MB;
large attachments, very high import KDF parameters and some legacy key types
are unsupported. The first UI does not show the recycle bin; recover it through
a compatible KeePass manager if needed. Avoid mixing edits through multiple
different password-manager applications while testing this sync workflow.

## Third-party engine hardening

KDBX parsing uses the upstream kdbxweb TypeScript source, bundled with patched
current XML and compression dependencies. The build applies a small documented
hardening change to validate the KDBX4 authenticated zero-length terminator and
reject bytes after it. The upstream reader otherwise returned after reading the
terminator length without verifying that last HMAC. Encryption and HMAC
construction remain the upstream KeePass-compatible algorithms. The build fails
if the patch point changes, requiring review on dependency updates.

## Validation and remaining work

Automated tests cover encryption/decryption, wrong passwords, changed ciphertext,
concurrent edits including equal timestamps, unrelated-vault rejection, interrupted
sync retry, delete propagation, history restoration, disk-write rollback, revision
checks, backup rotation, token reuse/expiry/revocation and certificate changes.
The Android Java HTTPS transport is exercised against the Node desktop sync
server over loopback, including rejection of a changed certificate. Separate
tests enforce private-address restrictions. An independent PyKeePass reader/writer
checks vault interoperability in both directions.

UI validation uses the packaged web UI at desktop and phone sizes with test
native bridges, real encrypted storage and TLS exchanges. This does not prove
that Android's actual WebView camera permission flow, its file picker, Windows
Firewall, DPAPI or native installation work on every device. Those need real
device testing, followed by an independent application/security review.

Autofill, biometric unlocking, background sync, TOTP generation, passkeys,
master-password changes and signed automatic updates are out of scope for 0.1.0.
The Android signing identity is unique to this app and retained separately from
the source/package. The Windows package uses the official Electron runtime;
the Plain Vault application itself has no separate publisher signature.
