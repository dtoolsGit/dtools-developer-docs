#!/usr/bin/env bash
# Export the CloudApi.V2 OpenAPI document for the public developer docs.
#
# Pipeline:  fetch raw spec  ->  normalize (servers, bearer auth, optional tier filter)  ->  assert no admin surface
# Output:    developer-docs/api-reference/openapi.v2.json
#
# This is the single source for the API reference. Run it locally to refresh, and in the
# Azure Pipeline (see Projects/pipelines/developer-docs-cd.yml) before deploying to Mintlify.
#
# Source options (pick with SPEC_URL or SPEC_FILE):
#   SPEC_URL   live spec endpoint to curl (default = dev Container App; verify this)
#   SPEC_FILE  use an already-downloaded spec instead of curling
#
# Tier (Phase 2 rail; default public = full spec):
#   DOCS_TIER  public | <tier-name with api-reference/tiers/<tier>.txt allowlist>
#
# Server overrides are read by normalize-openapi.mjs:
#   DOCS_PROD_SERVER, DOCS_DEV_SERVER  (both default to documented hosts; verify this)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$DOCS_DIR/api-reference/openapi.v2.json"
RAW="$(mktemp -t dtcloud-openapi-raw.XXXXXX.json)"
trap 'rm -f "$RAW"' EXIT

# verify this: the dev Container App host changes; confirm before relying on it in CI.
SPEC_URL="${SPEC_URL:-https://dtclouddev-cloudapi-v2.mangostone-d780ec9b.southindia.azurecontainerapps.io/swagger/v2/swagger.json}"
SPEC_FILE="${SPEC_FILE:-}"

if [[ -n "$SPEC_FILE" ]]; then
  echo "==> using local spec: $SPEC_FILE"
  cp "$SPEC_FILE" "$RAW"
else
  echo "==> fetching spec: $SPEC_URL"
  curl -fsSL --max-time 30 -o "$RAW" "$SPEC_URL"
fi

echo "==> normalizing"
node "$SCRIPT_DIR/normalize-openapi.mjs" "$RAW" "$OUT"

echo "==> admin-exclusion gate"
node "$SCRIPT_DIR/check-no-admin.mjs" "$OUT"

echo "==> done: $OUT"
