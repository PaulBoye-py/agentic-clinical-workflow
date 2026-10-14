#!/usr/bin/env bash
# Runs demo scenarios A-E against the deployed stack (real AWS calls).
# The TypeScript lives in services/scripts/run-scenario.ts so it can share the
# backend's types, schemas and AWS SDK dependencies.
#   scripts/run-scenario.sh            # all
#   scripts/run-scenario.sh --only A,C
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec npm --prefix "$ROOT/services" run -s scenario -- "$@"
