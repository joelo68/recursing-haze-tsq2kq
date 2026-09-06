import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { normalizeStoreLifecycleCore } from "../src/utils/storeLifecycle.js";

const MANAGE_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageStoreLifecycle";
const REPAIR_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/repairDirtySummaryNow";
const ANNUAL_ENDPOINT = "https://us-central1-cyjsituation-analysis.cloudfunctions.net/rebuildAnnualKpiSummaryNow";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM",
  authDomain: "cyjsituation-analysis.firebaseapp.com",
  projectId: "cyjsituation-analysis",
  storageBucket: "cyjsituation-analysis.firebasestorage.app",
  messagingSenderId: "139860745126",
  appId: "1:139860745126:web:4539176a4cf73ae4480d67",
};

const VALID_BRANDS = new Set(["cyj", "anniu", "yibo"]);

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[name] = true;
    else { args[name] = next; i += 1; }
  }
  return args;
}

function normalizeIsoDate(value = "") {
  const text = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
}

function enumerateRange(startText = "", endText = "") {
  const start = normalizeIsoDate(startText);
  const end = normalizeIsoDate(endText);
  if (!start || !end || start > end) throw new Error("invalid --start / --end date range");
  const result = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  while (cursor <= finish) { result.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return result;
}

function resolveDates(args, { required = true } = {}) {
  const direct = String(args.dates || "").split(",").map((v) => v.trim()).filter(Boolean);
  const range = args.start || args.end ? enumerateRange(String(args.start || ""), String(args.end || "")) : [];
  const dates = [...new Set([...direct, ...range])].sort();
  if (dates.length > 366) throw new Error("單次休店日設定最多 366 天");
  if (!dates.length && required) throw new Error("請使用 --dates 或 --start/--end 指定休店日");
  const invalid = dates.filter((date) => !normalizeIsoDate(date));
  if (invalid.length) throw new Error(`日期格式錯誤：${invalid.join(", ")}`);
  return dates;
}

function normalizeStoreKeys(value = "") {
  return [...new Set(String(value || "").split(",").map(normalizeStoreLifecycleCore).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function prompt(question, { hidden = false } = {}) {
  if (!hidden) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
  }
  process.stdout.write(question);
  let muted = true;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => rl.question("", (answer) => { muted = false; rl.close(); process.stdout.write("\n"); resolve(answer); }));
}

function getLifecycleMasterPath(brandId) {
  return brandId === "cyj" ? "artifacts/default-app-id/public/data/store_lifecycle/master" : `brands/${brandId}/store_lifecycle/master`;
}

function normalizeCurrentCalendar(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const closedDates = (Array.isArray(source.closedDates) ? source.closedDates : [])
    .map((row) => typeof row === "string" ? { date: row, reason: "" } : row)
    .filter((row) => normalizeIsoDate(row?.date))
    .map((row) => ({ date: normalizeIsoDate(row.date), reason: String(row.reason || "").trim() }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const storeClosureEvents = (Array.isArray(source.storeClosureEvents) ? source.storeClosureEvents : [])
    .map((row) => ({
      id: String(row?.id || row?.eventId || "").trim(),
      dates: [...new Set((Array.isArray(row?.dates) ? row.dates : [row?.date]).map(normalizeIsoDate).filter(Boolean))].sort(),
      storeKeys: [...new Set((Array.isArray(row?.storeKeys) ? row.storeKeys : [row?.storeKey]).map(normalizeStoreLifecycleCore).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant")),
      reason: String(row?.reason || "").trim(),
    }))
    .filter((row) => row.id && row.dates.length && row.storeKeys.length);
  return { revision: Math.max(0, Number(source.revision || 0)), closedDates, storeClosureEvents };
}

function stamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

async function postJson(url, body, idToken) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

async function getJson(url, idToken) {
  const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${idToken}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

const args = parseArgs(process.argv.slice(2));
const brands = [...new Set(String(args.brands || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean))];
if (!brands.length || brands.some((brandId) => !VALID_BRANDS.has(brandId))) {
  console.error("ABORT: --brands 只支援 cyj,anniu,yibo，例如 --brands cyj,anniu");
  process.exit(2);
}
const operation = String(args.operation || "add").trim().toLowerCase();
if (!["add", "remove"].includes(operation)) { console.error("ABORT: --operation 只支援 add 或 remove"); process.exit(2); }
const scope = String(args.scope || "brand").trim().toLowerCase() === "stores" ? "stores" : "brand";
const eventId = String(args["event-id"] || "").trim();
const storeKeys = normalizeStoreKeys(args["store-keys"] || "");
const datesRequired = !(scope === "stores" && operation === "remove");
const dates = resolveDates(args, { required: datesRequired });
const reason = String(args.reason || "").trim();
if (operation === "add" && !reason) { console.error('ABORT: 新增休店日必須指定 --reason'); process.exit(2); }
if (scope === "stores" && brands.length !== 1) { console.error("ABORT: 指定店家 scope 一次只允許一個品牌"); process.exit(2); }
if (scope === "stores" && operation === "add" && !storeKeys.length) { console.error("ABORT: 指定店家新增請使用 --store-keys 新店,板橋"); process.exit(2); }
if (scope === "stores" && operation === "remove" && !eventId) { console.error("ABORT: 指定店家取消請使用 --event-id <eventId>"); process.exit(2); }
const apply = args.apply === true || String(args.apply || "").toLowerCase() === "true";
if (apply && brands.length !== 1) { console.error("ABORT: 正式寫入一次只允許一個品牌；多品牌可先一起 dry-run，再逐品牌 --apply"); process.exit(2); }

const app = initializeApp(FIREBASE_CONFIG, `reporting-calendar-${Date.now()}`);
try {
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Firebase anonymous auth failed");
  const db = getFirestore(app);

  const before = {};
  console.log("=== REPORTING CALENDAR V2 PREVIEW ===");
  for (const brandId of brands) {
    const snap = await getDoc(doc(db, getLifecycleMasterPath(brandId)));
    if (!snap.exists()) throw new Error(`${brandId} store_lifecycle/master missing`);
    const master = snap.data() || {};
    const calendar = normalizeCurrentCalendar(master.reportingCalendar || {});
    before[brandId] = { master, calendar };
    console.log(`${brandId}: dataset=${master.datasetStatus || "unknown"} masterRevision=${Number(master.revision || 0)} calendarRevision=${calendar.revision} brandClosedDates=${calendar.closedDates.length} storeEvents=${calendar.storeClosureEvents.length}`);
  }
  console.log(`scope=${scope}`);
  console.log(`operation=${operation}`);
  console.log(`dates=${dates.join(",") || "(event-id removal)"}`);
  console.log(`storeKeys=${storeKeys.join(",") || "-"}`);
  console.log(`eventId=${eventId || "-"}`);
  console.log(`reason=${reason || "(remove)"}`);

  if (!apply) {
    console.log("");
    console.log("DRY_RUN_ONLY=YES");
    console.log("Firestore writes: 0");
    console.log("加上 --apply 才會正式寫入。");
  } else {
    const accountId = String(args["account-id"] || await prompt("最高管理者帳號識別： ")).trim();
    const deviceId = String(args["device-id"] || await prompt("Trusted Device ID： ")).trim();
    const userName = String(args["user-name"] || accountId || "最高管理者").trim();
    const credentialPassword = String(await prompt("目前最高管理者登入密碼（輸入不回顯）： ", { hidden: true }));
    if (!accountId || !deviceId || !credentialPassword) throw new Error("accountId / deviceId / password 不可為空");

    const brandId = brands[0];
    const current = before[brandId].calendar;
    const report = { generatedAtText: new Date().toISOString(), operation, scope, brands, dates, storeKeys, eventId, reason, updates: [], repairs: [], annualRebuilds: [], verification: [] };

    console.log("\n=== APPLY REPORTING CALENDAR V2 ===");
    const result = await postJson(MANAGE_ENDPOINT, {
      brandId,
      action: "update_reporting_calendar_v2",
      operation,
      scope,
      dates,
      reason,
      storeKeys,
      eventId,
      expectedCalendarRevision: current.revision,
      actor: { roleId: "director", accountId, userName, deviceId, credentialPassword },
    }, idToken);
    report.updates.push({ brandId, result });
    const writtenEventId = String(result?.eventId || eventId || "");
    console.log(`${brandId}: changed=${result.changed === true} calendarRevision=${result.reportingCalendar?.revision ?? current.revision} eventId=${writtenEventId || "-"} affectedHistoricalMonths=${(result.affectedHistoricalMonths || []).join(",") || "-"}`);

    console.log("\n=== SEQUENTIAL HISTORICAL SUMMARY REPAIR ===");
    for (const yearMonth of result?.affectedHistoricalMonths || []) {
      const url = `${REPAIR_ENDPOINT}?brandId=${encodeURIComponent(brandId)}&yearMonth=${encodeURIComponent(yearMonth)}&force=true`;
      const repair = await getJson(url, idToken);
      report.repairs.push({ brandId, yearMonth, result: repair });
      console.log(`${brandId}/${yearMonth}: repair ok`);
    }

    const annualKeys = [...new Set(report.repairs.map((row) => `${row.brandId}:${row.yearMonth.slice(0, 4)}`))];
    if (annualKeys.length) console.log("\n=== REBUILD AFFECTED ANNUAL KPI V2 ===");
    for (const key of annualKeys) {
      const [annualBrandId, yearText] = key.split(":");
      const annual = await postJson(ANNUAL_ENDPOINT, { brandId: annualBrandId, year: Number(yearText) }, idToken);
      report.annualRebuilds.push({ brandId: annualBrandId, year: Number(yearText), result: annual });
      const row = Array.isArray(annual?.results) ? annual.results[0] : null;
      console.log(`${annualBrandId}/${yearText}: basedMonthCount=${row?.basedMonthCount ?? "?"} storeCount=${row?.storeCount ?? "?"}`);
    }

    console.log("\n=== POST-WRITE CALENDAR VERIFICATION ===");
    const snap = await getDoc(doc(db, getLifecycleMasterPath(brandId)));
    const master = snap.exists() ? (snap.data() || {}) : {};
    const calendar = normalizeCurrentCalendar(master.reportingCalendar || {});
    const mismatches = [];
    if (scope === "brand") {
      const dateSet = new Set(calendar.closedDates.map((row) => row.date));
      const expectedPresent = operation === "add";
      dates.forEach((date) => { if (dateSet.has(date) !== expectedPresent) mismatches.push(date); });
    } else if (operation === "add") {
      const event = calendar.storeClosureEvents.find((row) => row.id === writtenEventId);
      if (!event) mismatches.push("event_missing");
      else {
        if (JSON.stringify(event.dates) !== JSON.stringify(dates)) mismatches.push("dates_mismatch");
        if (JSON.stringify(event.storeKeys) !== JSON.stringify(storeKeys)) mismatches.push("store_keys_mismatch");
      }
    } else if (calendar.storeClosureEvents.some((row) => row.id === eventId)) mismatches.push("event_still_present");

    const row = { brandId, masterRevision: Number(master.revision || 0), beforeMasterRevision: Number(before[brandId].master.revision || 0), calendarRevision: calendar.revision, brandClosedDateCount: calendar.closedDates.length, storeClosureEventCount: calendar.storeClosureEvents.length, mismatches };
    report.verification.push(row);
    console.log(`${brandId}: masterRevision=${row.masterRevision} calendarRevision=${row.calendarRevision} mismatches=${mismatches.length}`);
    if (row.masterRevision !== row.beforeMasterRevision) throw new Error(`${brandId}: Lifecycle master revision changed unexpectedly`);
    if (mismatches.length) throw new Error(`${brandId}: reporting calendar V2 post-write verification failed: ${mismatches.join(",")}`);

    const outDir = path.join(os.homedir(), "Downloads", "WORK");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `DRCYJ_REPORTING_CALENDAR_V2_${operation.toUpperCase()}_${stamp()}.json`);
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log("\nREPORTING_CALENDAR_V2_APPLY=COMPLETE");
    console.log(`REPORT=${outPath}`);
    console.log("RAW_DAILY_REPORT_WRITES=0");
  }
} finally {
  await deleteApp(app).catch(() => {});
}
