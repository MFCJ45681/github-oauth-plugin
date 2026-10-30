#!/usr/bin/env bash
# Install @local/github-oauth into the active DSH web profile.
#
#   ./install.sh                 # profile from DSH_PROFILE_DIR, else $DSH_HOME/profiles/web
#   DSH_PROFILE_DIR=/path ./install.sh
#
# The plugin is copied into <profile>/node_modules/@local/github-oauth and its
# bundle name is appended to dsh.profile.bundles. Restart DSH afterwards.
#
# Re-running is cheap: when the plugin files have not changed (content hash
# recorded in <dest>/.install-hash) the copy is skipped, and the profile
# package.json is only rewritten when the bundle is not registered yet.
set -euo pipefail

PKG_NAME='@local/github-oauth'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${DSH_PROFILE_DIR:-}" ]]; then
  PROFILE="$DSH_PROFILE_DIR"
elif [[ -n "${DSH_HOME:-}" ]]; then
  PROFILE="$DSH_HOME/profiles/web"
else
  PROFILE="$HOME/.dsh/profiles/web"
fi

if [[ ! -f "$PROFILE/package.json" ]]; then
  echo "error: no DSH profile at $PROFILE (set DSH_PROFILE_DIR)" >&2
  exit 1
fi

DEST="$PROFILE/node_modules/@local/github-oauth"
FILES=(lib scripts package.json cordis.patch.yml README.md CHANGELOG.md LICENSE)

source_hash() {
  ( cd "$HERE" && find "${FILES[@]}" -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1 )
}

HASH="$(source_hash)"
echo "→ installing $PKG_NAME into $PROFILE"

if [[ -f "$DEST/.install-hash" && "$(cat "$DEST/.install-hash")" == "$HASH" ]]; then
  echo "  files unchanged ($HASH), skipping copy"
else
  mkdir -p "$PROFILE/node_modules/@local"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -R "$HERE/lib" "$HERE/scripts" "$DEST/"
  cp "$HERE/package.json" "$HERE/cordis.patch.yml" "$HERE/README.md" "$HERE/CHANGELOG.md" "$HERE/LICENSE" "$DEST/"
  printf '%s\n' "$HASH" > "$DEST/.install-hash"
  echo "  copied files ($HASH)"
fi

node - "$PROFILE/package.json" "$PKG_NAME" <<'NODE'
const fs = require('node:fs')
const [file, name] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
if (bundles.includes(name)) {
  console.log(`  dsh.profile.bundles already lists ${name}`)
  process.exit(0)
}
bundles.push(name)
pkg.dsh.profile.bundles = bundles
const tmp = `${file}.tmp-${process.pid}`
fs.writeFileSync(tmp, `${JSON.stringify(pkg, null, 2)}\n`, { mode: 0o600 })
fs.renameSync(tmp, file)
console.log(`  dsh.profile.bundles: ${bundles.join(', ')}`)
NODE

echo
echo "✓ installed. Next:"
echo "  1. restart DSH (the running process will not pick the plugin up otherwise)"
echo "  2. open the GitHub panel in the right sidebar and click \"使用 GitHub 登录\""
echo "     the built-in OAuth App works out of the box; no GitHub app to create"
echo "  3. optional: use your own app in Settings → GitHub, or"
echo "     node $HERE/scripts/configure.js set --client-id <id> --client-secret-stdin"
echo "     (callback URL: http://127.0.0.1:3080/plugins/github-oauth/callback)"
