#!/usr/bin/env node
// Hard gate: assert the public docs spec contains NO admin/internal surface.
//
// Source of truth: AdminController.* and BudgetAdminController carry
// [ApiExplorerSettings(IgnoreApi=true)] and must never reach the published reference.
// This check is defense-in-depth in case that attribute is ever dropped.
//
// Fails (exit 1) if any path, operationId, or tag looks admin/internal.
// Usage: node check-no-admin.mjs <spec.json>

import { readFileSync } from "node:fs";

const specPath = process.argv[2];
if (!specPath) {
  console.error("usage: node check-no-admin.mjs <spec.json>");
  process.exit(2);
}

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const FORBIDDEN = [/\/admin\b/i, /budgetadmin/i, /\binternal\b/i];

const violations = [];

for (const [path, item] of Object.entries(spec.paths || {})) {
  if (FORBIDDEN.some((re) => re.test(path))) violations.push(`path: ${path}`);
  for (const method of Object.keys(item)) {
    const op = item[method];
    if (!op || typeof op !== "object") continue;
    const id = op.operationId || "";
    if (FORBIDDEN.some((re) => re.test(id))) violations.push(`operationId: ${method.toUpperCase()} ${path} (${id})`);
    for (const tag of op.tags || []) {
      if (FORBIDDEN.some((re) => re.test(tag))) violations.push(`tag: ${tag} on ${method.toUpperCase()} ${path}`);
    }
  }
}

const opCount = Object.values(spec.paths || {}).reduce(
  (n, item) => n + Object.keys(item).filter((m) => item[m] && typeof item[m] === "object" && "operationId" in item[m]).length,
  0,
);

if (violations.length) {
  console.error(`FAIL: ${violations.length} admin/internal surface(s) leaked into the public spec:`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log(`OK: no admin/internal surface in ${specPath} (${Object.keys(spec.paths || {}).length} paths, ${opCount} operations).`);
