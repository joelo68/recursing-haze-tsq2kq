import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";

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
    else {
      args[name] = next;
      i += 1;
    }
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
  while (cursor <= finish) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function resolveDates(args) {
  const direct = String(args.dates || "").split(",").map((v) => v.trim()).filter(Boolean);
  const range = args.start || args.end ? enumerateRange(String(args.start || ""), String(args.end || "")) : [];
  const dates = [...new Set([...direct, ...range])].sort();
  if (!dates.length) throw new Error("請使用 --dates 或 --start/--end 指定公休日");
  const invalid = dates.filter((date) => !normalizeIsoDate(date));
  if (invalid.length) throw new Error(`日期格式錯誤：${invalid.join(", ")}`);
  return dates;
}

function prompt(question, { hidden = false } = {}) {
  if (!hidden) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }));
  }

  process.stdout.write(question);
  let muted = true;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => rl.question("", (answer) => {
    muted = false;
    rl.close();
    process.stdout.write("\n");
    resolve(answer);
  }));
}

function getLifecycleMasterPath(brandId) {
  return brandId === "cyj"
    ? "artifacts/default-app-id/public/data/store_lifecycle/master"
    : `brands/${brandId}/store_lifecycle/master`;
}

function normalizeCurrentCalendar(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const closedDates = (Array.isArray(source.closedDates) ? source.closedDates : [])
    .map((row) => typeof row === "string" ? { date: row, reason: "" } : row)
    .filter((row) => normalizeIsoDate(row?.date))
    .map((row) => ({ date: normalizeIsoDate(row.date), reason: String(row.reason || "").trim() }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    revision: Math.max(0, Number(source.revision || 0)),
    closedDates,
  };
}

function stamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

async function postJson(url, body, idToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  }
  return data;
}

async function getJson(url, idToken) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  }
  return data;
}

const args = parseArgs(process.argv.slice(2));
const brands = [...new Set(String(args.brands || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean))];
if (!brands.length || brands.some((brandId) => !VALID_BRANDS.has(brandId))) {
  console.error("ABORT: --brands 只支援 cyj,anniu,yibo，例如 --brands cyj,anniu");
  process.exit(2);
}

const dates = resolveDates(args);
const operation = String(args.operation || "add").trim().toLowerCase();
if (!["add", "remove"].includes(operation)) {
  console.error("ABORT: --operation 只支援 add 或 remove");
  process.exit(2);
}

const reason = String(args.reason || "").trim();
if (operation === "add" && !reason) {
  console.error('ABORT: 新增公休日必須指定 --reason，例如 --reason "2026春節全國休假"');
  process.exit(2);
}

const apply = args.apply === true || String(args.apply || "").toLowerCase() === "true";

const app = initializeApp(FIREBASE_CONFIG, `reporting-calendar-${Date.now()}`);
const auth = getAuth(app);
await signInAnonymously(auth);
const idToken = await auth.currentUser?.getIdToken();
if (!idToken) throw new Error("Firebase anonymous auth failed");
const db = getFirestore(app);

const before = {};
console.log("=== REPORTING CALENDAR PREVIEW ===");
for (const brandId of brands) {
  const snap = await getDoc(doc(db, getLifecycleMasterPath(brandId)));
  if (!snap.exists()) throw new Error(`${brandId} store_lifecycle/master missing`);
  const master = snap.data() || {};
  const calendar = normalizeCurrentCalendar(master.reportingCalendar || {});
  before[brandId] = { master, calendar };
  console.log(
    `${brandId}: dataset=${master.datasetStatus || "unknown"} `
    + `masterRevision=${Number(master.revision || 0)} `
    + `calendarRevision=${calendar.revision} `
    + `currentClosedDates=${calendar.closedDates.length}`
  );
}
console.log(`operation=${operation}`);
console.log(`dates=${dates.join(",")}`);
console.log(`reason=${reason || "(remove)"}`);

if (!apply) {
  console.log("");
  console.log("DRY_RUN_ONLY=YES");
  console.log("Firestore writes: 0");
  console.log("加上 --apply 才會正式寫入。");
  process.exit(0);
}

const accountId = String(args["account-id"] || await prompt("最高管理者帳號識別： ")).trim();
const deviceId = String(args["device-id"] || await prompt("Trusted Device ID： ")).trim();
const userName = String(args["user-name"] || accountId || "最高管理者").trim();
const credentialPassword = String(await prompt("目前最高管理者登入密碼（輸入不回顯）： ", { hidden: true }));
if (!accountId || !deviceId || !credentialPassword) {
  console.error("ABORT: accountId / deviceId / password 不可為空");
  process.exit(2);
}

const report = {
  generatedAtText: new Date().toISOString(),
  operation,
  brands,
  dates,
  reason,
  updates: [],
  repairs: [],
  annualRebuilds: [],
  verification: [],
};

console.log("");
console.log("=== APPLY REPORTING CALENDAR ===");
for (const brandId of brands) {
  const current = before[brandId].calendar;
  const result = await postJson(MANAGE_ENDPOINT, {
    brandId,
    action: "update_reporting_calendar",
    operation,
    dates,
    reason,
    expectedCalendarRevision: current.revision,
    actor: {
      roleId: "director",
      accountId,
      userName,
      deviceId,
      credentialPassword,
    },
  }, idToken);

  report.updates.push({ brandId, result });
  console.log(
    `${brandId}: changed=${result.changed === true} `
    + `calendarRevision=${result.reportingCalendar?.revision ?? current.revision} `
    + `affectedHistoricalMonths=${(result.affectedHistoricalMonths || []).join(",") || "-"}`
  );
}

console.log("");
console.log("=== SEQUENTIAL HISTORICAL SUMMARY REPAIR ===");
for (const update of report.updates) {
  const brandId = update.brandId;
  for (const yearMonth of update.result?.affectedHistoricalMonths || []) {
    const url = `${REPAIR_ENDPOINT}?brandId=${encodeURIComponent(brandId)}&yearMonth=${encodeURIComponent(yearMonth)}&force=true`;
    const result = await getJson(url, idToken);
    report.repairs.push({ brandId, yearMonth, result });
    console.log(`${brandId}/${yearMonth}: repair ok`);
  }
}

const annualKeys = [...new Set(report.repairs.map((row) => `${row.brandId}:${row.yearMonth.slice(0, 4)}`))];
if (annualKeys.length) {
  console.log("");
  console.log("=== REBUILD AFFECTED ANNUAL KPI V2 ===");
}
for (const key of annualKeys) {
  const [brandId, yearText] = key.split(":");
  const result = await postJson(ANNUAL_ENDPOINT, { brandId, year: Number(yearText) }, idToken);
  report.annualRebuilds.push({ brandId, year: Number(yearText), result });
  const row = Array.isArray(result?.results) ? result.results[0] : null;
  console.log(
    `${brandId}/${yearText}: basedMonthCount=${row?.basedMonthCount ?? "?"} `
    + `storeCount=${row?.storeCount ?? "?"}`
  );
}

console.log("");
console.log("=== POST-WRITE CALENDAR VERIFICATION ===");
for (const brandId of brands) {
  const snap = await getDoc(doc(db, getLifecycleMasterPath(brandId)));
  const master = snap.exists() ? (snap.data() || {}) : {};
  const calendar = normalizeCurrentCalendar(master.reportingCalendar || {});
  const expectedPresent = operation === "add";
  const dateSet = new Set(calendar.closedDates.map((row) => row.date));
  const mismatches = dates.filter((date) => dateSet.has(date) !== expectedPresent);
  const row = {
    brandId,
    masterRevision: Number(master.revision || 0),
    beforeMasterRevision: Number(before[brandId].master.revision || 0),
    calendarRevision: calendar.revision,
    closedDateCount: calendar.closedDates.length,
    mismatches,
  };
  report.verification.push(row);

  console.log(
    `${brandId}: masterRevision=${row.masterRevision} `
    + `calendarRevision=${row.calendarRevision} `
    + `mismatches=${mismatches.length}`
  );

  if (row.masterRevision !== row.beforeMasterRevision) {
    throw new Error(`${brandId}: Lifecycle master revision changed unexpectedly`);
  }
  if (mismatches.length) {
    throw new Error(`${brandId}: reporting calendar post-write verification failed`);
  }
}

const outDir = path.join(os.homedir(), "Downloads", "WORK");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `DRCYJ_REPORTING_CALENDAR_${operation.toUpperCase()}_${stamp()}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log("");
console.log("REPORTING_CALENDAR_APPLY=COMPLETE");
console.log(`REPORT=${outPath}`);
console.log("RAW_DAILY_REPORT_WRITES=0");
