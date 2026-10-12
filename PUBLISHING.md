# Publishing downloads

The source repository is public at
[orbholdings/plain-vault](https://github.com/orbholdings/plain-vault).

Use GitHub Releases for the installable downloads. The Windows ZIP is larger
than GitHub's regular repository file limit; it belongs in a release asset.

1. Open [New release](https://github.com/orbholdings/plain-vault/releases/new).
2. Create tag `v0.1.0` targeting `main`.
3. Set the title to **Plain Vault 0.1.0 — Public Preview** and paste the contents
   of [RELEASE-NOTES-0.1.0.md](RELEASE-NOTES-0.1.0.md) into the description.
4. Attach the APK, Windows ZIP, quick-start text and SHA256SUMS text supplied
   with the testing release.
5. Select **This is a pre-release**, then publish it.

GitHub automatically provides source ZIP and tar archives for the release tag.
The tagged source requires `npm run build` before native packaging.

Keep the Android signing backup private. It is needed to sign future compatible
updates and must never be attached to a release or committed to Git.

In repository Settings → Code security, enable private vulnerability reporting
if available. Suitable repository topics include `password-manager`, `offline`,
`android`, `windows`, `keepass`, `kdbx` and `local-sync`.
