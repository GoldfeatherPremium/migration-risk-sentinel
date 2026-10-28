#!/usr/bin/env bash
# Builds the CLI from source into an isolated temp directory.
# Only installs pinned npm packages (zod, typescript, @types/node); no secrets are used.
set -euo pipefail
WORK="${RUNNER_TEMP:-/tmp}/migration-guard"
rm -rf "$WORK"
mkdir -p "$WORK/packages"
cp -R "$MG_SOURCE/core" "$WORK/packages/core"
cp -R "$MG_SOURCE/cli" "$WORK/packages/cli"
rm -rf "$WORK/packages/cli/dist" "$WORK/packages/cli/node_modules"
cat > "$WORK/package.json" <<'JSON'
{ "name": "migration-guard-action-build", "private": true, "type": "module" }
JSON
cd "$WORK"
npm install --no-audit --no-fund --ignore-scripts --silent zod@3.25.76 typescript@5.8.3 @types/node@22.16.5
cd packages/cli
"$WORK/node_modules/.bin/tsc" -p tsconfig.build.json
echo "MG_CLI=$WORK/packages/cli/dist/cli/src/cli.js" >> "${GITHUB_ENV:-/dev/null}"
echo "Built CLI at $WORK/packages/cli/dist/cli/src/cli.js"
