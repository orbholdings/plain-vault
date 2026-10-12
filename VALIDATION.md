# Plain Vault 0.1.0 validation — 12 October 2026

This is a first testing release. No independent security audit or native
Windows/Android hardware test has been completed.

Completed checks:

- 13 automated core, storage and transport tests passed with zero failures.
  These include modified payload/terminator/trailing-byte rejection, wrong
  passwords, offline edits, equal-time conflicts and convergence, history
  restoration, deleted-entry propagation, unrelated-vault rejection, retry
  after an interrupted response, failed-write rollback, revision races,
  backup rotation, token expiry/reuse/revocation and certificate pinning.
- The Android Java TLS implementation connected to the desktop Node HTTPS
  implementation over loopback and rejected a different certificate. Private
  destination restrictions are tested separately. This is transport testing,
  rather than a physical phone-to-PC Wi-Fi test.
- Independent PyKeePass 4.2.0 read a Plain Vault KDBX successfully. Plain Vault
  also reopened and read a vault updated by PyKeePass.
- The actual packaged web UI passed automated checks at 1120×800 desktop and
  393×852 phone sizes: create/unlock, add/edit/search, generator, copy, export,
  QR pairing, initial encrypted vault transfer, TLS sync, history and locking.
  Test bridges connect the UI to real encrypted storage and local TLS; native
  platform file-picker, camera, DPAPI and Keystore behaviour remain unverified.
- Desktop and mobile layouts were visually inspected; mobile has no horizontal
  page overflow, and all four tool sections are visible.
- Production dependency audit reported zero known vulnerabilities after
  updating XML, compression and certificate-generation dependencies.
- Android package compiled, aligned, release-signed and verified with APK
  Signature Scheme v3. Application ID: `com.plainapps.vault`; versionCode 1;
  minimum API 28; target API 35. Only Internet and Camera permissions are present.
- Official Electron 44.7.0 Windows x64 runtime SHA-256 was verified against its
  published release checksum. The portable ZIP has valid CRCs and its executable
  has the expected PE signature. The Windows executable was not run on Windows.
- Android and Windows packaged UI/engine bytes match the final generated assets;
  the Android package includes compiled DEX, and the Windows package includes the
  final main-process source and its production dependencies.

Remaining practical checks: installation on the user's S24 Ultra and Windows
PC, real Wi-Fi/hotspot/firewall pairing, Android camera/file-picker/lifecycle
behaviour, Windows DPAPI/clipboard/OS-lock behaviour, followed by an independent
security review before storing important credentials.
