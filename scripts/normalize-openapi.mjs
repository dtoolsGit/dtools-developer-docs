#!/usr/bin/env node
// Normalize a raw CloudApi.V2 OpenAPI document for the public developer docs.
//
// What it does (and only this — keep transforms minimal and auditable):
//   1. Rewrites `servers` to real, documented hosts (the raw spec ships either a
//      `dtcloud.example.invalid` placeholder — see Tools/dtcloud-cli/scripts/update-openapi.sh —
//      or an internal Azure Container Apps host; neither belongs in public docs).
//   2. Adds an HTTP bearer (JWT) security scheme + a default security requirement so the
//      Mintlify API playground renders an Authorization header. The v2 API requires an
//      Entra External ID bearer token but does not advertise a securityScheme in the raw
//      spec, so we add one here. (verify this: confirm the scheme name/flow with the API team.)
//   3. Optional per-plan-tier filter (Phase 2 rail, OFF by default): when DOCS_TIER is set to
//      something other than "public"/"all", keep only operations whose path or operationId
//      matches an allowlist in api-reference/tiers/<tier>.txt. Launch ships the full public spec.
//
// It deliberately does NOT strip admin endpoints — those are already excluded upstream via
// [ApiExplorerSettings(IgnoreApi=true)]. check-no-admin.mjs asserts that invariant separately.
//
// Usage: node normalize-openapi.mjs <input.json> <output.json>
// Env:
//   DOCS_PROD_SERVER  (default https://dtcloudapi.d-tools.cloud            — verify this)
//   DOCS_DEV_SERVER   (default https://dtoolsdevapi.azure-api.net          — verify this)
//   DOCS_TIER         (default "public" => no filtering)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node normalize-openapi.mjs <input.json> <output.json>");
  process.exit(2);
}

const PROD_SERVER = process.env.DOCS_PROD_SERVER || "https://dtcloudapi.d-tools.cloud";
const DEV_SERVER = process.env.DOCS_DEV_SERVER || "https://dtoolsdevapi.azure-api.net";
const TIER = (process.env.DOCS_TIER || "public").trim();

const spec = JSON.parse(readFileSync(inPath, "utf8"));

// 1) Servers — replace whatever shipped with documented, public hosts.
spec.servers = [
  { url: PROD_SERVER, description: "Production (verify this)" },
  { url: DEV_SERVER, description: "Development (verify this)" },
];

// 2) Bearer security scheme for the playground.
spec.components = spec.components || {};
spec.components.securitySchemes = spec.components.securitySchemes || {};
if (!spec.components.securitySchemes.bearerAuth) {
  spec.components.securitySchemes.bearerAuth = {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Entra External ID (CIAM) access token. See the Authentication guide for how to obtain one (device-code via the CLI, or your own OAuth flow).",
  };
}
// Default requirement at the document level; anonymous endpoints (health, MCP metadata)
// still respond without a token — this only drives the playground's auth affordance.
if (!Array.isArray(spec.security) || spec.security.length === 0) {
  spec.security = [{ bearerAuth: [] }];
}

// 2a) Keep operation summaries short and single-line. Mintlify derives the API reference page
// filename/slug from `summary`; sentence-long or multi-line summaries cause ENAMETOOLONG on
// build and ugly slugs. We keep the first line (capped) as the summary and move the rest into
// the description, where it still renders.
const SUMMARY_MAX = 100;
let summariesFixed = 0;
for (const item of Object.values(spec.paths || {})) {
  for (const op of Object.values(item)) {
    if (!op || typeof op !== "object" || !("operationId" in op)) continue;
    if (typeof op.summary !== "string") continue;
    const raw = op.summary;
    let head = raw.split(/\r?\n/)[0].trim();
    let overflow = raw.slice(head.length).trim();
    if (head.length > SUMMARY_MAX) {
      const cut = head.slice(0, SUMMARY_MAX);
      const at = cut.lastIndexOf(" ");
      const keep = at > 40 ? cut.slice(0, at) : cut;
      overflow = `${head.slice(keep.length)}\n\n${overflow}`.trim();
      head = keep.replace(/[.,;:]+$/, "") + "…";
    }
    if (head !== raw) {
      op.summary = head;
      if (overflow) op.description = op.description ? `${overflow}\n\n${op.description}` : overflow;
      summariesFixed++;
    }
  }
}

// 2b) Surface x-dtools-* metadata as a rendered badge line in each operation description.
// Mintlify (and most renderers) do not render arbitrary `x-` extensions, so we fold the
// load-bearing ones into the description where they always render. Idempotent via a sentinel.
const META_SENTINEL = "<!-- x-dtools-meta -->";
function bool(v) {
  return v === true ? "yes" : v === false ? "no" : null;
}
function buildMetaLine(op) {
  const parts = [];
  if (op["x-dtools-capability-family"]) parts.push(`**Capability:** \`${op["x-dtools-capability-family"]}\``);
  if (op["x-dtools-policy"]) parts.push(`**Policy:** \`${op["x-dtools-policy"]}\``);
  if (op["x-dtools-access-depth"]) parts.push(`**Access depth:** \`${op["x-dtools-access-depth"]}\``);
  if (op["x-dtools-default-release-stage"]) parts.push(`**Release stage:** \`${op["x-dtools-default-release-stage"]}\``);
  if (bool(op["x-dtools-release-gated"]) !== null) parts.push(`**Release-gated:** ${bool(op["x-dtools-release-gated"])}`);
  if (bool(op["x-dtools-idempotent"]) !== null) parts.push(`**Idempotent:** ${bool(op["x-dtools-idempotent"])}`);
  if (bool(op["x-dtools-async-job"]) !== null) parts.push(`**Async job:** ${bool(op["x-dtools-async-job"])}`);
  if (op["x-dtools-workload-class"]) parts.push(`**Workload:** \`${op["x-dtools-workload-class"]}\``);
  return parts.length ? `${META_SENTINEL}\n\n${parts.join(" · ")}` : null;
}
let metaCount = 0;
for (const item of Object.values(spec.paths || {})) {
  for (const op of Object.values(item)) {
    if (!op || typeof op !== "object" || !("operationId" in op)) continue;
    if (typeof op.description === "string" && op.description.includes(META_SENTINEL)) continue;
    const line = buildMetaLine(op);
    if (!line) continue;
    op.description = op.description ? `${line}\n\n${op.description}` : line;
    metaCount++;
  }
}

// 3) Optional per-plan-tier filter (Phase 2 rail; no-op for public/all).
function applyTierFilter(doc, tier) {
  if (!tier || tier === "public" || tier === "all") return { kept: countOps(doc), dropped: 0 };
  const here = dirname(fileURLToPath(import.meta.url));
  const allowFile = resolve(here, "..", "api-reference", "tiers", `${tier}.txt`);
  if (!existsSync(allowFile)) {
    console.error(`DOCS_TIER=${tier} but no allowlist at ${allowFile}`);
    process.exit(3);
  }
  const allow = readFileSync(allowFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const matches = (path, op) =>
    allow.some((rule) =>
      rule.startsWith("op:")
        ? op?.operationId === rule.slice(3)
        : path === rule || path.startsWith(rule.replace(/\*$/, "")),
    );
  let kept = 0;
  let dropped = 0;
  for (const [path, item] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(item)) {
      const op = item[method];
      if (op && typeof op === "object" && "operationId" in op) {
        if (matches(path, op)) kept++;
        else {
          delete item[method];
          dropped++;
        }
      }
    }
    if (Object.keys(item).length === 0) delete doc.paths[path];
  }
  return { kept, dropped };
}

function countOps(doc) {
  let n = 0;
  for (const item of Object.values(doc.paths || {})) {
    for (const method of Object.keys(item)) {
      const op = item[method];
      if (op && typeof op === "object" && "operationId" in op) n++;
    }
  }
  return n;
}

const { kept, dropped } = applyTierFilter(spec, TIER);

writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n");
console.log(
  `normalized -> ${outPath}\n` +
    `  servers: ${spec.servers.map((s) => s.url).join(", ")}\n` +
    `  summaries shortened: ${summariesFixed}\n` +
    `  x-dtools meta lines injected: ${metaCount}\n` +
    `  tier: ${TIER} (operations kept=${kept}, dropped=${dropped})`,
);
