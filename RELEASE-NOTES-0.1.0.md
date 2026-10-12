# Plain Vault 0.1.0 — Public Preview

An offline password manager for Windows x64 and Android with manual local Wi-Fi
sync and encrypted KeePass-compatible KDBX vaults.

**Experimental preview: use test credentials. Independent security review and
physical Windows/Android testing are still pending.**

## Included

- Passwords and secure notes, search, categories and a password generator.
- Manual local sync with QR pairing and a pinned TLS certificate.
- Conflict history, encrypted import/export and the last 10 local backups.
- Automatic locking and clipboard clearing.
- No account, ads, analytics or cloud service.

## Downloads and setup

- Android 9+: install `Plain-Vault-0.1.0-Android.apk`.
- Windows 10/11 x64: extract the entire `Plain-Vault-0.1.0-Windows-x64.zip`
  and open `Plain-Vault.exe` inside the extracted folder.
- Read `Plain-Vault-Quick-Start.txt` for pairing and backup instructions.
- Verify downloads against `Plain-Vault-SHA256SUMS.txt`.

Create a vault on the PC, connect both devices to the same Wi-Fi or hotspot, and
use Local sync to pair the phone. That local network does not need internet.
Use the same master passphrase on both devices; the passphrase is not transmitted.

## Validation and limits

13 automated vault, storage and transport tests passed. Additional checks cover
KDBX interoperability, the bundled UI, Android signing and Windows package
integrity. See [VALIDATION.md](VALIDATION.md) for what was and was not tested.

Android autofill, browser extensions, biometric unlocking, background sync, TOTP
generation, passkeys and changing the master password are not included. Only
password-based KDBX credentials are supported. Keep a separate encrypted export:
local backups do not protect against device loss, and there is no password reset.
