import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");

test("Summary repair flag carries System Exclusion repair intent into the worker job", () => {
  assert.match(
    source,
    /systemExclusionRepairRequired:\s*Number\(data\.requiredSystemExclusionRevision \|\| 0\)\s*>\s*Number\(data\.systemExclusionRevision \|\| 0\)/
  );
});

test("Summary transaction verifies both Reporting Calendar and System Exclusion revisions", () => {
  assert.match(source, /builtSystemExclusionRevision/);
  assert.match(source, /requiredSystemExclusionRevision/);
  assert.match(
    source,
    /const verified =\s*rawMatched === true\s*&& calendarCurrent\s*&& systemExclusionCurrent/
  );
  assert.match(source, /system_exclusion_revision_changed_during_rebuild/);
  assert.match(source, /system_exclusion_race_guard/);
});

test("System Exclusion repaired historical Summary converges Annual by brand/year", () => {
  assert.match(source, /const systemExclusionAnnualKeys = new Set\(\)/);
  assert.match(source, /job\.systemExclusionRepairRequired === true/);
  assert.match(source, /system_exclusion_summary_repair/);
  assert.match(source, /const annualRepairKeys = new Set\(\[/);
});

test("Annual writer refuses partial System Exclusion authority and rechecks authority before write", () => {
  assert.match(source, /systemExclusionStaleMonths/);
  assert.match(source, /SYSTEM_EXCLUSION_SUMMARY_REVISION_MISMATCH/);
  assert.match(source, /latestSystemExclusionSnap = await getAuditExclusionsDocRef\(normalizedBrandId\)\.get\(\)/);
  assert.match(source, /annualSystemExclusionStillCurrent/);
  assert.match(source, /System Exclusion authority changed during rebuild/);
});

test("Annual convergence remains event-driven without new polling", () => {
  const repairBlock = source.slice(
    source.indexOf("exports.repairDirtySummaries"),
    source.indexOf("exports.repairDirtySummaries") + 8000
  );
  assert.doesNotMatch(repairBlock, /setInterval\s*\(/);
  assert.doesNotMatch(repairBlock, /setTimeout\s*\(/);
});
