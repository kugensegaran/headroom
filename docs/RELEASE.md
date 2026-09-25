# Releasing Headroom

`scripts/release.sh` does the whole release: bundles Node, signs inside out with hardened runtime, notarizes and staples the app, builds and notarizes the DMG, writes the Sparkle appcast and drafts a GitHub Release on the public releases repo.

`scripts/release.sh --adhoc` runs the same steps with ad-hoc signing and stops before notarization. Use it to check the pipeline on any Mac.

## One-time setup (Kugen, in Terminal, never through chat)

1. **Developer ID certificate.** Xcode, Settings, Accounts, your team, Manage Certificates, +, Developer ID Application. Check with `security find-identity -v -p codesigning`.
2. **Notarization credentials.** Create an app-specific password at account.apple.com (Sign-In and Security, App-Specific Passwords), then run
   `xcrun notarytool store-credentials headroom --apple-id kugenesh@gmail.com --team-id YOURTEAMID`
   and paste the password when asked. It is stored in your keychain.
3. **Sparkle key.** `cd mac && .build/artifacts/sparkle/Sparkle/bin/generate_keys`, then put the printed public key in `mac/Info.plist` as `SUPublicEDKey`. Back up the private key (`generate_keys -x file`) in a password manager.
4. **Releases repo.** A public repo (default `kugensegaran/headroom-releases`, override with `RELEASE_REPO`) with GitHub Pages on, serving `appcast.xml` at the `SUFeedURL` in `mac/Info.plist`.

## Each release

1. Bump the version in both `package.json` and `mac/Info.plist` (`CFBundleShortVersionString`); the script refuses if they differ. Commit.
2. `scripts/release.sh`
3. Check the draft on GitHub, publish it, then copy `build/release/appcast.xml` to the releases repo's Pages branch.
4. Run docs/QA.md on a clean user account with the new DMG.

## Notes

- Node is signed with `mac/node.entitlements` (JIT and unsigned executable memory), which V8 needs under hardened runtime.
- The build number is the commit count, so every release has a higher one.
- Do not ship through the Mac App Store: the sandbox blocks spawning MCP servers and editing other apps' config files.
