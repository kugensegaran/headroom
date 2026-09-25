# Releasing Headroom

Needs an Apple Developer Program membership and a "Developer ID Application" certificate in your keychain.

1. Build a self-contained app:
   `scripts/build-app.sh --bundle-node`
2. Sign with hardened runtime (sign the bundled node first, then the app):
   ```
   ID="Developer ID Application: Your Name (TEAMID)"
   codesign --force --options runtime --timestamp --sign "$ID" "build/Headroom.app/Contents/Resources/bin/node"
   codesign --force --options runtime --timestamp --sign "$ID" "build/Headroom.app"
   ```
   Node needs JIT: if it crashes under hardened runtime, sign it with an entitlements file containing
   `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`.
3. Notarize and staple:
   ```
   ditto -c -k --keepParent "build/Headroom.app" build/Headroom.zip
   xcrun notarytool submit build/Headroom.zip --keychain-profile headroom --wait
   xcrun stapler staple "build/Headroom.app"
   ```
   One-time setup: `xcrun notarytool store-credentials headroom --apple-id you@example.com --team-id TEAMID`
4. Package as a DMG and upload to the store (Lemon Squeezy or Paddle).

Do not ship through the Mac App Store: the sandbox blocks spawning MCP servers and editing other apps' config files.
