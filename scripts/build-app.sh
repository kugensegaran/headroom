#!/usr/bin/env bash
# Build "Headroom.app" on macOS.
#   scripts/build-app.sh                 debug-signed app using the Node already on this Mac
#   scripts/build-app.sh --bundle-node   also bundle an official Node binary (self-contained app)
#   scripts/build-app.sh --run           build, then open the app
# Signing for distribution (Developer ID + notarization) is in docs/RELEASE.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build"
APP="$OUT/Headroom.app"
NODE_VERSION="${NODE_VERSION:-22.20.0}"
BUNDLE_NODE=0
RUN=0
for a in "$@"; do
  case "$a" in
    --bundle-node) BUNDLE_NODE=1 ;;
    --run) RUN=1 ;;
  esac
done

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script builds the macOS app and must run on a Mac." >&2
  exit 1
fi

echo "==> Engine: installing dependencies and running tests"
cd "$ROOT"
git config core.hooksPath .githooks 2>/dev/null || true
npm install --silent
npm test

echo "==> Swift: building menu bar app"
cd "$ROOT/mac"
if [[ "$(xcode-select -p)" != *Xcode*.app* ]]; then
  echo "Full Xcode is required. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi
swift test --quiet
swift build -c release
BIN="$(swift build -c release --show-bin-path)/Headroom"

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/engine"
cp "$BIN" "$APP/Contents/MacOS/Headroom"
cp "$ROOT/mac/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/mac/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp -R "$ROOT/src" "$ROOT/package.json" "$APP/Contents/Resources/engine/"
(cd "$APP/Contents/Resources/engine" && npm install --omit=dev --silent)

if [[ $BUNDLE_NODE == 1 ]]; then
  ARCH="$(uname -m)"; [[ "$ARCH" == "x86_64" ]] && ARCH="x64"
  TARBALL="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
  echo "==> Bundling Node ${NODE_VERSION} (${ARCH})"
  mkdir -p "$OUT/cache" "$APP/Contents/Resources/bin"
  [[ -f "$OUT/cache/$TARBALL" ]] || curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}" -o "$OUT/cache/$TARBALL"
  tar -xzf "$OUT/cache/$TARBALL" -C "$OUT/cache"
  cp "$OUT/cache/node-v${NODE_VERSION}-darwin-${ARCH}/bin/node" "$APP/Contents/Resources/bin/node"
fi

echo "==> Ad-hoc signing (local use only)"
codesign --force --deep --sign - "$APP"

echo "Built: $APP"
if [[ $RUN == 1 ]]; then
  pkill -x Headroom 2>/dev/null || true
  open "$APP"
fi
