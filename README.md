# Plain Vault

An offline password manager for **Windows x64 and Android**, with manual local
Wi-Fi sync, KeePass-compatible KDBX files and encrypted backup/export.

**Experimental preview: use test credentials until real-device testing and an
independent security review are complete.** The project is MIT licensed and open
for testing, contributions and security review.

## What it does

| Feature | Behaviour |
| --- | --- |
| Vault | Passwords and secure notes in an encrypted KDBX file |
| Everyday tools | Search, categories and password generator |
| Local sync | Manual sync over the same Wi-Fi or hotspot; no internet required |
| Pairing | One-use QR code and a pinned TLS certificate |
| Conflicts | Preserve versions in entry history |
| Backups | Encrypted import/export and the last 10 local backups |
| Locking | Two-minute inactivity lock and automatic clipboard clearing |

No account, ads, analytics or cloud service. The optional support link opens only
when you press it. Android autofill, browser extensions, biometric unlocking,
background sync, TOTP generation, passkeys and changing the master password are
not included in 0.1.0. Password-only KDBX vaults are supported; key-file and
hardware challenge-response credentials are not supported.

## Get started

Installable previews will be listed under
[GitHub Releases](https://github.com/orbholdings/plain-vault/releases).
To use the first testing packages:

1. Install the Android APK on Android 9 or newer, with a recent System WebView.
2. Extract the entire Windows ZIP and open `Plain-Vault.exe` on Windows 10/11 x64.
3. Create a vault on the PC using dummy logins. Start Local sync and show its
   pairing QR code.
4. Connect your phone to the same Wi-Fi or hotspot, choose **Pair with my PC**
   and enter the same master passphrase to unlock the transferred vault.

See [QUICK-START.txt](QUICK-START.txt) for pairing, firewall, backups and recovery
instructions. There is no master password reset. Keep a separate encrypted export.

## Security status

Vaults use AES-256, HMAC authentication and Argon2id with 64 MiB of memory, three
passes and one lane. Local sync transfers encrypted vault data over TLS with a
pinned certificate. The master passphrase is not transmitted. Windows DPAPI and
Android Keystore protect pairing material on their respective platforms.

13 automated vault, storage and transport tests passed, alongside KDBX
interoperability, bundled UI and package checks. Physical Windows/Android testing
and an independent audit are still pending. These checks do not establish that
the preview is safe for important credentials.

Read [PRIVACY-AND-SECURITY.md](PRIVACY-AND-SECURITY.md),
[VALIDATION.md](VALIDATION.md) and [SECURITY.md](SECURITY.md) for details.

## Build

Install Node.js 24 and JDK 17 or newer. All runtime dependencies are pinned;
use the lockfile. From a fresh checkout:

```sh
git clone https://github.com/orbholdings/plain-vault.git
cd plain-vault
npm ci --ignore-scripts
npm run build
npm run setup-java-tests
npm test
```

The web and Node bundles use kdbxweb's TypeScript source, current patched
compression/XML dependencies and an authenticated-terminator hardening plugin
in `scripts/build-web.cjs`. There are no remote assets.

### Windows portable ZIP

`npm run package:windows` downloads the pinned official Electron Windows runtime,
verifies its SHA-256 checksum and creates `dist/Plain-Vault-0.1.0-Windows-x64.zip`.
It needs Python 3 and npm. A Windows machine can run the app through `npm start`
after installing Electron's binary using `npm rebuild electron`.

### Android

Use Android SDK build-tools 35, Android API 35 `android.jar`, a JDK or the Eclipse
ECJ compiler, and your private signing key. Keep signing material out of the repo.
Supply `PLAIN_VAULT_SIGNING_PASSWORD` through the environment.

```sh
python3 scripts/build-android.py \
  --build-tools /path/to/sdk/build-tools/35.0.0 \
  --android-jar /path/to/sdk/platforms/android-35/android.jar \
  --keystore /private/path/release.p12
```

Add `--ecj /path/to/ecj.jar` when building with a JRE rather than javac. The script
compiles resources, compiles/desugars Java, aligns the APK, signs it and verifies
the signature. Use the same private signing identity for future APK upgrades.

### Tests

The Java helper compiles the transport harness without requiring an Android SDK:

```sh
npm run setup-java-tests
npm test
```

The GitHub workflow builds the engine, compiles the Java harness, runs these tests
and audits production dependencies. It uses read-only repository permissions;
it does not sign or publish downloads.

For visual/end-to-end checks, install Playwright and its Chromium browser:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/ui-smoke.cjs
```

Alternatively, set `CODEX_PRIMARY_RUNTIME_NODE_MODULES` to a node_modules
directory containing Playwright. Optional
`PLAIN_VAULT_TEST_CHROME` selects a Chrome executable. The test bridge is only in
the test script; it is not shipped in the application.

## Layout

- `src`: shared UI and KDBX operations.
- `desktop`: sandboxed Electron shell, atomic encrypted storage and TLS sync.
- `android`: dependency-free Java WebView shell, scoped files, Keystore-protected
  pairing and pinned HTTPS transport.
- `tests`: meaningful encryption, merge, backup and transport tests.
- `web`: generated, bundled app assets (created by the build; not committed).
- `scripts`: repeatable Android and Windows packaging.

The desktop listener uses a stable TCP port of 48521. Pair again if the PC's
private IPv4 address changes. Multiple concurrent PC apps must not share a vault
directory; an OS-level single-instance lock prevents this in the packaged app.

## Contribute and support

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and bug reports,
[SECURITY.md](SECURITY.md) for vulnerability reporting, and
[PUBLISHING.md](PUBLISHING.md) for download release instructions.

Source code is licensed under [MIT](LICENSE). Bundled third-party components
retain their own licenses; see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

[Buy me a coffee](https://square.link/u/kAddgU4q) — optional support for the project.
