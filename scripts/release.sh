#!/usr/bin/env bash
# Build, sign, notarize and package Headroom for distribution.
#   scripts/release.sh            full release: Developer ID signing, notarization, DMG, appcast, draft GitHub Release
#   scripts/release.sh --adhoc    same steps with ad-hoc signing and no notarization or upload (checks the pipeline)
# Needs (full release only):
#   - a "Developer ID Application" certificate in the login keychain (or DEVELOPER_ID="Developer ID Application: Name (TEAM)")
#   - notarization credentials stored once with: xcrun notarytool store-credentials headroom
#   - the Sparkle private key in the keychain (generate_keys)
#   - gh logged in, and the public releases repo (RELEASE_REPO, default kugensegaran/headroom-site)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/Headroom.app"
OUT="$ROOT/build/release"
ADHOC=0
[[ "${1:-}" == "--adhoc" ]] && ADHOC=1
RELEASE_REPO="${RELEASE_REPO:-kugensegaran/headroom-site}"
NOTARY_PROFILE="${NOTARY_PROFILE:-headroom}"
SPARKLE_BIN="$ROOT/mac/.build/artifacts/sparkle/Sparkle/bin"

VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$ROOT/mac/Info.plist")"
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
if [[ "$VERSION" != "$PKG_VERSION" ]]; then
  echo "Version mismatch: mac/Info.plist says $VERSION, package.json says $PKG_VERSION." >&2
  exit 1
fi
BUILD="$(git -C "$ROOT" rev-list --count HEAD)"

if [[ $ADHOC == 1 ]]; then
  ID="-"
else
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
    echo "Commit or stash your changes first; a release must match a commit." >&2
    exit 1
  fi
  ID="${DEVELOPER_ID:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)}"
  if [[ -z "$ID" ]]; then
    echo "No Developer ID Application certificate found. See docs/RELEASE.md." >&2
    exit 1
  fi
  xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 || {
    echo "No notarization credentials. Run: xcrun notarytool store-credentials $NOTARY_PROFILE" >&2
    exit 1
  }
  [[ -n "$(/usr/libexec/PlistBuddy -c 'Print SUPublicEDKey' "$ROOT/mac/Info.plist" 2>/dev/null)" ]] || {
    echo "SUPublicEDKey is empty in mac/Info.plist, so shipped apps could never update. Run generate_keys first." >&2
    exit 1
  }
fi

echo "==> Headroom $VERSION ($BUILD), signing as: $ID"
"$ROOT/scripts/build-app.sh" --bundle-node
/usr/libexec/PlistBuddy -c "Set CFBundleVersion $BUILD" "$APP/Contents/Info.plist"

sign() { codesign --force --timestamp$([[ $ID == "-" ]] && echo "=none") --options runtime --sign "$ID" "$@"; }
# Ad-hoc signatures have no Team ID, so the hardened runtime's library validation would stop the app
# loading Sparkle. The ad-hoc check keeps the runtime on node (where the JIT entitlements matter) only.
if [[ $ADHOC == 1 ]]; then
  sign_app() { codesign --force --sign - "$@"; }
else
  sign_app() { sign "$@"; }
fi

echo "==> Signing, inside out"
sign --entitlements "$ROOT/mac/node.entitlements" "$APP/Contents/Resources/bin/node"
SP="$APP/Contents/Frameworks/Sparkle.framework/Versions/B"
sign_app "$SP/XPCServices/Installer.xpc"
sign_app --preserve-metadata=entitlements "$SP/XPCServices/Downloader.xpc"
sign_app "$SP/Autoupdate"
sign_app "$SP/Updater.app"
sign_app "$APP/Contents/Frameworks/Sparkle.framework"
sign_app "$APP"
codesign --verify --deep --strict --verbose=1 "$APP"

notarize() {
  xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" --wait
}

mkdir -p "$OUT"
if [[ $ADHOC == 0 ]]; then
  echo "==> Notarizing the app"
  ditto -c -k --keepParent "$APP" "$OUT/Headroom-notarize.zip"
  notarize "$OUT/Headroom-notarize.zip"
  xcrun stapler staple "$APP"
  rm "$OUT/Headroom-notarize.zip"
fi

echo "==> Building the DMG"
DMG="$OUT/Headroom-$VERSION.dmg"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Headroom $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
rm -rf "$STAGE"

if [[ $ADHOC == 1 ]]; then
  echo "Ad-hoc build ready: $DMG (not notarized, for checking the pipeline only)"
  exit 0
fi

sign "$DMG"
echo "==> Notarizing the DMG"
notarize "$DMG"
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose "$DMG"

echo "==> Appcast"
"$SPARKLE_BIN/generate_appcast" --download-url-prefix "https://github.com/$RELEASE_REPO/releases/download/v$VERSION/" "$OUT"

echo "==> Draft GitHub Release on $RELEASE_REPO"
gh release create "v$VERSION" "$DMG" --repo "$RELEASE_REPO" --draft --title "Headroom $VERSION" --notes "Headroom $VERSION"
echo "Done. Check the draft, publish it, then publish $OUT/appcast.xml to the Pages site."
