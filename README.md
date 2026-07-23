# developer-docs

Public developer documentation for the D-Tools Cloud **v2 platform** — REST API, MCP bridge,
and CLI — published with [Mintlify](https://mintlify.com). See
[ADR-0005](../docs/adr/0005-developer-docs-platform.md) for the decision record.

## Canonical repository

The canonical source for these Mintlify docs is
[`dtoolsGit/dtools-developer-docs`](https://github.com/dtoolsGit/dtools-developer-docs).
Create all new documentation branches, commits, pull requests, and Mintlify integrations
against that repository.

The former `abdul-siq/dtools-developer-docs` repository is historical and read-only. Do not use
it for new documentation or deployment work. Before pushing, verify:

```bash
git remote get-url origin
# git@github.com:dtoolsGit/dtools-developer-docs.git
```

## Layout

```
developer-docs/
  docs.json                 Mintlify site config (navigation, theme)
  index.mdx                 Home / overview
  getting-started/          Quickstart, authentication
  platform/                 Concepts, error contract
  api-reference/
    introduction.mdx        How to read the reference + x-dtools metadata
    openapi.v2.json         Exported, normalized v2 spec (generated — do not hand-edit)
    tiers/                  Per-plan-tier allowlists (Phase 2; empty at launch)
  mcp/bridge.mdx            MCP bridge documentation
  cli/                      dtcloud CLI overview, install, command reference
  scripts/                  Spec export + validation tooling
```

## Refresh the API reference

The reference is generated from the live v2 OpenAPI document. Regenerate it with:

```bash
# From the repo root or anywhere:
bash developer-docs/scripts/export-openapi.sh
```

This fetches the spec, normalizes servers, adds the `bearerAuth` scheme, folds `x-dtools-*`
metadata into operation descriptions, and runs the admin-exclusion gate. Override the source or
servers via env vars (see the script header): `SPEC_URL`, `SPEC_FILE`, `DOCS_PROD_SERVER`,
`DOCS_DEV_SERVER`, `DOCS_TIER`.

Commit the regenerated `api-reference/openapi.v2.json` (committed-spec model).

## Preview locally

```bash
cd developer-docs
npx mint dev            # serves http://localhost:3000  (verify this default port)
npx mint openapi-check api-reference/openapi.v2.json
npx mint broken-links
```

> The Mintlify CLI package is `mint` (formerly `mintlify`). _(verify this — the package name
> and commands change; check https://www.mintlify.com/docs.)_

## Deploy

Deployment runs from Azure Pipelines — see
[`Projects/pipelines/developer-docs-cd.yml`](../Projects/pipelines/developer-docs-cd.yml).
It requires a Mintlify account/project and a `MINTLIFY_API_KEY` pipeline secret.

## What's intentionally excluded

- **Admin/internal endpoints** — excluded upstream by `[ApiExplorerSettings(IgnoreApi=true)]`
  and enforced by `scripts/check-no-admin.mjs`.
- **End-user auth / per-plan gating** — not enabled at launch (docs are public). Phase 2 only.
