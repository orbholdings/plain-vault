# Contributing to Plain Vault

Bug reports, documentation improvements, real-device testing and security reviews
are welcome. This is an experimental preview; use invented credentials when
testing or sharing examples.

## Development

Install Node.js 24, JDK 17 or newer, and Git. From a fresh checkout:

```sh
npm ci --ignore-scripts
npm run build
npm run setup-java-tests
npm test
```

See [README.md](README.md) for native packaging and the optional Playwright UI
checks. Generated `web/`, `build/`, `dist/` and dependencies are not committed.

## Changes and reports

Describe the problem, steps to reproduce it, and the expected behaviour. Include
the app version, OS version and device model. For local sync problems, describe
the network and firewall setup without posting pairing codes, IP addresses you
consider private, or personal vault contents.

Keep changes focused. Preserve the offline behaviour, narrow native bridges,
certificate pinning, encrypted backups and conflict history. Add a meaningful
regression check when changing encryption, storage or sync behaviour. Describe
the checks you ran in the pull request.

Do not commit real passwords, vaults, pairing tokens, private signing keys or
credentials. Security findings should follow [SECURITY.md](SECURITY.md).

Contributions are licensed under this repository's [MIT license](LICENSE).
