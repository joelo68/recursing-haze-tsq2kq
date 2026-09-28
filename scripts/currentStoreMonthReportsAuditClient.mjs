import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';

const ENDPOINT = 'https://us-central1-cyjsituation-analysis.cloudfunctions.net/auditCurrentStoreMonthReportsProjection';
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

const args = parseArgs(process.argv.slice(2));
const brands = normalizeBrands(args.brands || args.brand || 'all');
const yearMonth = String(args.month || '').trim();
const accountId = String(args['account-id'] || await prompt('最高管理者帳號識別： ')).trim();
const deviceId = String(args['device-id'] || await prompt('Trusted Device ID： ')).trim();
const userName = String(args['user-name'] || accountId || '最高管理者').trim();
const credentialPassword = String(await prompt('目前最高管理者登入密碼（輸入不回顯）： ', { hidden: true }));

if (!accountId || !deviceId || !credentialPassword) {
  console.error('ABORT: accountId / deviceId / password 不可為空');
  process.exit(2);
}

const app = initializeApp(FIREBASE_CONFIG, `current-store-month-audit-${Date.now()}`);
try {
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Firebase anonymous auth failed');

  const results = [];
  console.log('=== CURRENT STORE-MONTH PROJECTION READ-ONLY AUDIT ===');
  for (const brandId of brands) {
    process.stdout.write(`${brandId}: `);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          brandId,
          ...(yearMonth ? { yearMonth } : {}),
          actor: {
            roleId: 'director',
            accountId,
            userName,
            deviceId,
            credentialPassword,
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.message || `HTTP ${response.status}`);
      }
      if (
        result?.auditOnly !== true
        || Number(result?.firestoreWrites || result?.readEstimate?.firestoreWrites || 0) !== 0
      ) {
        throw new Error('Backend response is not read-only');
      }

      results.push(result);
      console.log(
        `raw=${result.raw?.rawDocCount ?? '?'}`
        + ` projectionActive=${result.projection?.activeProjectionReportCount ?? '?'}`
        + ` projectionDocs=${result.projection?.projectionDocCount ?? '?'}`
        + ` parity=${result.comparison?.parity === true ? 'PASS' : 'NO'}`
        + ` sourceOnly=${result.comparison?.sourceOnly?.total ?? '?'}`
        + ` projectionOnly=${result.comparison?.projectionOnly?.total ?? '?'}`
        + ` invalid=${result.comparison?.rawInvalidCount ?? '?'}`
        + ` duplicates=${result.comparison?.rawDuplicateStoreDateCount ?? '?'}`
        + ` estDataReads=${result.readEstimate?.estimatedDataReads ?? '?'}`
      );
    } catch (error) {
      results.push({ ok: false, brandId, error: error.message });
      console.log(`FAILED | ${error.message}`);
    }
  }

  const outDir = path.join(os.homedir(), 'Downloads', 'WORK');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `DRCYJ_P2_A2_4B2A_CURRENT_STORE_MONTH_AUDIT_${stamp()}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify({
    auditOnly: true,
    firestoreWrites: 0,
    generatedAtText: new Date().toISOString(),
    endpoint: ENDPOINT,
    brandsRequested: brands,
    results,
  }, null, 2)}\n`, 'utf8');

  console.log(`\nREPORT=${outPath}`);
  console.log('FIRESTORE_WRITES=0');
  console.log('BOOTSTRAP_PERFORMED=NO');
} finally {
  await deleteApp(app).catch(() => {});
}
