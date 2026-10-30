#!/usr/bin/env bash
# Remove @local/github-oauth from the active DSH web profile.
# The encrypted vault (<DSH_HOME>/github-oauth) is left untouched unless --purge is given.
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

DEST="$PROFILE/node_modules/@local/github-oauth"
echo "→ removing $PKG_NAME from $PROFILE"
rm -rf "$DEST"

node - "$PROFILE/package.json" "$PKG_NAME" <<'NODE'
const fs = require('node:fs')
const [file, name] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const bundles = pkg?.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  pkg.dsh.profile.bundles = bundles.filter((entry) => entry !== name)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(pkg, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
  console.log(`  dsh.profile.bundles: ${pkg.dsh.profile.bundles.join(', ')}`)
}
NODE

if [[ "${1:-}" == '--purge' ]]; then
  DATA_DIR="${GITHUB_OAUTH_DATA_DIR:-${DSH_HOME:-$HOME/.dsh}/github-oauth}"
  echo "→ purging encrypted vault at $DATA_DIR"
  rm -rf "$DATA_DIR"
fi

echo "✓ removed. Restart DSH to unload the routes and tools."
echo "  note: $HERE is only the source checkout; delete it separately."
