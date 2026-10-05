import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");
const promptSource = fs.readFileSync(path.join(root, "functions/telegram/prompts.js"), "utf8");
const telegramDoc = fs.readFileSync(path.join(root, "docs/TELEGRAM_AGENT.md"), "utf8");

function section(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `missing end token: ${endToken}`);
  return source.slice(start, end);
}

test("scheduled proactive reports keep provenance in snapshots but do not append engineering footer", () => {
  assert.doesNotMatch(indexSource, /function appendTelegramScheduledDataFooter\(/);
  assert.doesNotMatch(indexSource, /appendTelegramScheduledDataFooter\(/);

  const patrol = section(
    indexSource,
    "exports.notificationPatrol = onSchedule",
    "exports.telegramTaskFollowUp = onSchedule"
  );

  assert.match(patrol, /createTelegramReportSnapshot\(/);
  assert.match(patrol, /policyIds,/);
  assert.match(patrol, /sourceMeta,/);
  assert.match(patrol, /const message = String\(built\.message \|\| ""\)\.trim\(\)\.slice\(0, 3900\);/);
  assert.match(patrol, /const scheduledMessage = String\(item\.finalMessage \|\| ""\)\.trim\(\)\.slice\(0, 3900\);/);

  assert.doesNotMatch(patrol, /資料截止：\$\{snapshot\.cutoffAtText\}/);
  assert.doesNotMatch(patrol, /報表快照：\$\{snapshot\.snapshotId\}/);
  assert.doesNotMatch(patrol, /口徑：\$\{snapshot\.metricVersion\}/);
});

test("active-alert proactive delivery is clean while snapshot audit metadata remains", () => {
  const active = section(
    indexSource,
    "exports.telegramAgentDailyPatrol = onSchedule",
    "// ==========================================\n// ★ 4. Telegram 動態定時推播巡邏員 v5"
  );

  assert.match(active, /createTelegramReportSnapshot\(/);
  assert.match(active, /policyIds: item\.ctx\?\.activePolicyIds \|\| \[\]/);
  assert.match(active, /sourceMeta: item\.result\?\.source_meta \|\| \[\]/);
  assert.match(active, /const alertMessage = String\(item\.message \|\| ""\)\.trim\(\)\.slice\(0, 3900\);/);

  assert.doesNotMatch(active, /資料截止：\$\{alertSnapshot\.cutoffAtText\}/);
  assert.doesNotMatch(active, /報表快照：\$\{alertSnapshot\.snapshotId\}/);
});

test("manual snapshot inspection still exposes provenance on explicit request", () => {
  const commands = section(
    indexSource,
    "const snapshotRead = raw.match",
    "if (/^\\/(schedules|schedule)$/i.test(raw)"
  );

  assert.match(commands, /資料截止：\$\{snapshot\.cutoffAtText/);
  assert.match(commands, /報表快照：\$\{snapshot\.snapshotId/);
  assert.match(commands, /口徑：\$\{snapshot\.metricVersion/);
});

test("prompt and canonical documentation define engineering provenance as internal-only for proactive pushes", () => {
  assert.match(
    promptSource,
    /主動推播的來源／Policy／截止時間／快照／metric provenance 只保留在 backend snapshot \/ audit，不直接附在使用者訊息/
  );
  assert.doesNotMatch(promptSource, /後端會統一附上極簡資料 footer/);

  assert.match(
    telegramDoc,
    /scheduled report／active alert 的一般主動推播只呈現營運內容，不再附加工程診斷 footer/
  );
  assert.match(
    telegramDoc,
    /snapshot ID、metric version 仍完整保留在 `telegram_report_snapshots`／audit 供追查/
  );
  assert.match(
    telegramDoc,
    /`\/snapshots`、`\/snapshot \.\.\.` 或明確要求查看快照時，仍可顯示上述 provenance/
  );
});
