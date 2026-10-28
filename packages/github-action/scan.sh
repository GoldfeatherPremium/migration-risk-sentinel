#!/usr/bin/env bash
# Runs the analyzer, writes a job summary and optional SARIF, and propagates the exit code.
set -uo pipefail
CLI="${MG_CLI:?MG_CLI not set; run build.sh first}"
read -r -a PATHS <<< "${MG_PATHS:-supabase/migrations}"
ARGS=("${PATHS[@]}" --fail-on "${MG_FAIL_ON:-error}")
if [ -n "${MG_CONFIG:-}" ]; then ARGS+=(--config "$MG_CONFIG"); fi

REPORT="$(mktemp)"
node "$CLI" scan "${ARGS[@]}" --format markdown --output "$REPORT"
CODE=$?

if [ "$CODE" -le 1 ]; then
  cat "$REPORT" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
else
  echo "Supabase Migration Guard could not run (exit code $CODE). See the step log." >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
fi

if [ -n "${MG_SARIF:-}" ] && [ "$CODE" -le 1 ]; then
  node "$CLI" scan "${ARGS[@]}" --fail-on never --format sarif --output "$MG_SARIF"
fi

echo "exit-code=$CODE" >> "${GITHUB_OUTPUT:-/dev/null}"
node "$CLI" scan "${ARGS[@]}" --format text --fail-on never || true
exit "$CODE"
