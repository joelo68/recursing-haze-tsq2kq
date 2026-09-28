import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';

const ENDPOINT = 'https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageCurrentStoreMonthReportsReadiness';
const CONFIRMATION = 'PROMOTE_CURRENT_STORE_MONTH_REPORTS_READY';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM',
  authDomain: 'cyjsituation-analysis.firebaseapp.com',
  projectId: 'cyjsituation-analysis',
  storageBucket: 'cyjsituation-analysis.firebasestorage.app',
  messagingSenderId: '139860745126',
  appId: '1:139860745126:web:4539176a4cf73ae4480d67',
};
const SUPPORTED_BRANDS = ['cyj', 'anniu', 'yibo'];

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[name] = true;
    else { args[name] = next; i += 1; }
  }
  return args;
}

function normalizeBrands(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'all') return [...SUPPORTED_BRANDS];
  const values = [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))];
  const invalid = values.filter((item) => !SUPPORTED_BRANDS.includes(item));
  if (invalid.length) throw new Error(`Unsupported brand(s): ${invalid.join(', ')}`);
  return values;
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
  return new Promise((resolve) => rl.question('', (answer) => {
    muted = false;
    rl.close();
    process.stdout.write('\n');
    resolve(answer);
  }));
}

function stamp() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date()).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

async function callEndpoint({ idToken, brandId, yearMonth, actor, action, expectedRevision, confirmation }) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      brandId,
      ...(yearMonth ? { yearMonth } : {}),
      action,
      ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}),
      ...(confirmation ? { confirmation } : {}),
      actor,
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { httpStatus: response.status, ...body };
}

const args = parseArgs(process.argv.slice(2));
const brands = normalizeBrands(args.brands || args.brand || 'all');
const yearMonth = String(args.month || '').trim();
const applyRequested = args.apply === true || String(args.apply || '').toLowerCase() === 'true';
const accountId = String(args['account-id'] || await prompt('最高管理者帳號識別： ')).trim();
const deviceId = String(args['device-id'] || await prompt('Trusted Device ID： ')).trim();
const userName = String(args['user-name'] || accountId || '最高管理者').trim();
const credentialPassword = String(await prompt('目前最高管理者登入密碼（輸入不回顯）： ', { hidden: true }));

if (!accountId || !deviceId || !credentialPassword) {
  console.error('ABORT: accountId / deviceId / password 不可為空');
  process.exit(2);
}

const actor = {
  roleId: 'director',
  accountId,
  userName,
  deviceId,
  credentialPassword,
};

const app = initializeApp(FIREBASE_CONFIG, `current-store-month-readiness-${Date.now()}`);
try {
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Firebase anonymous auth failed');

  const planResults = [];
  console.log('=== CURRENT STORE-MONTH READINESS PLAN ===');
  for (const brandId of brands) {
    process.stdout.write(`${brandId}: `);
    try {
      const result = await callEndpoint({
        idToken,
        brandId,
        yearMonth,
        actor,
        action: 'plan',
      });
      if (result.httpStatus >= 400 || result.ok === false) {
        throw new Error(result.code || `HTTP ${result.httpStatus}`);
      }
      planResults.push(result);
      console.log(
        `${result.readiness?.code || 'UNKNOWN'}`
        + ` | revision=${result.readiness?.revision ?? '?'}`
        + ` | currentParity=${result.audit?.comparison?.parity === true ? 'PASS' : 'NO'}`
        + ` | consumerReady=${result.readiness?.consumerReady === true ? 'YES' : 'NO'}`
      );
    } catch (error) {
      planResults.push({ ok: false, brandId, error: error.message });
      console.log(`FAILED | ${error.message}`);
    }
  }

  const promotable = planResults.filter((item) => item?.readiness?.promotable === true);
  const applyResults = [];

  if (applyRequested && promotable.length > 0) {
    console.log('\nAPPLY 將只處理 READY_TO_PROMOTE 的品牌。');
    const confirmation = await prompt(`請輸入 ${CONFIRMATION}： `);
    if (confirmation !== CONFIRMATION) {
      console.error('ABORT: confirmation 不一致，未執行任何 readiness promotion');
      process.exit(3);
    }

    console.log('\n=== CURRENT STORE-MONTH READINESS APPLY ===');
    for (const plan of promotable) {
      const brandId = String(plan.brandId || plan.audit?.brandId || '');
      process.stdout.write(`${brandId}: `);
      try {
        const result = await callEndpoint({
          idToken,
          brandId,
          yearMonth: yearMonth || plan.yearMonth || plan.audit?.yearMonth || '',
          actor,
          action: 'apply',
          expectedRevision: Number(plan.readiness?.revision),
          confirmation,
        });
        applyResults.push(result);
        if (result.httpStatus >= 400 || result.ok === false) {
          console.log(`NO | ${result.code || `HTTP ${result.httpStatus}`}`);
        } else {
          console.log(
            `${result.readiness?.code || 'UNKNOWN'}`
            + ` | consumerReady=${result.readiness?.consumerReady === true ? 'YES' : 'NO'}`
            + ` | writes=${result.firestoreWrites ?? '?'}`
          );
        }
      } catch (error) {
        applyResults.push({ ok: false, brandId, error: error.message });
        console.log(`FAILED | ${error.message}`);
      }
    }
  } else if (applyRequested) {
    console.log('\n沒有 READY_TO_PROMOTE 品牌，因此沒有執行 write。');
  }

  const outDir = path.join(os.homedir(), 'Downloads', 'WORK');
  fs.mkdirSync(outDir, { recursive: true });
  const mode = applyRequested ? 'APPLY' : 'PLAN';
  const outPath = path.join(
    outDir,
    `DRCYJ_P2_A2_4B3_2_CURRENT_STORE_MONTH_READINESS_${mode}_${stamp()}.json`
  );

  fs.writeFileSync(outPath, `${JSON.stringify({
    mode,
    applyRequested,
    generatedAtText: new Date().toISOString(),
    endpoint: ENDPOINT,
    brandsRequested: brands,
    planResults,
    applyResults,
  }, null, 2)}\n`, 'utf8');

  console.log(`\nREPORT=${outPath}`);
  console.log(`APPLY_REQUESTED=${applyRequested ? 'YES' : 'NO'}`);
  console.log(`PROMOTABLE_BRANDS=${promotable.map((item) => item.brandId || item.audit?.brandId).filter(Boolean).join(',') || 'NONE'}`);
} finally {
  await deleteApp(app).catch(() => {});
}
