#!/usr/bin/env bash
# Publish site/ (and build/release/appcast.xml when present) to the public site repo's GitHub Pages.
#   scripts/deploy-site.sh             deploy to SITE_REPO (default kugensegaran/headroom-site)
#   SITE_DOMAIN=example.com scripts/deploy-site.sh   also write a CNAME for a custom domain
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE_REPO="${SITE_REPO:-kugensegaran/headroom-site}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gh repo view "$SITE_REPO" >/dev/null 2>&1 || { echo "$SITE_REPO does not exist yet. Create it (public) first." >&2; exit 1; }
git clone --quiet "https://github.com/$SITE_REPO.git" "$WORK/site"
cd "$WORK/site"
git checkout --quiet gh-pages 2>/dev/null || git checkout --quiet --orphan gh-pages
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$ROOT/site/." .
[[ -f "$ROOT/build/release/appcast.xml" ]] && cp "$ROOT/build/release/appcast.xml" .
[[ -n "${SITE_DOMAIN:-}" ]] && echo "$SITE_DOMAIN" > CNAME
touch .nojekyll
git add -A
if git diff --cached --quiet; then
  echo "Nothing changed."
  exit 0
fi
git -c user.name="Kugen Segaran" -c user.email="kugenesh@gmail.com" commit --quiet -m "Update site"
git push --quiet origin gh-pages
gh api -X POST "repos/$SITE_REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || true
echo "Deployed to https://${SITE_DOMAIN:-${SITE_REPO%%/*}.github.io/${SITE_REPO#*/}}/"
