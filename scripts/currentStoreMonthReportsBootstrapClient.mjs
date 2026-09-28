import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';

const ENDPOINT = 'https://us-central1-cyjsituation-analysis.cloudfunctions.net/bootstrapCurrentStoreMonthReports';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM',
  authDomain: 'cyjsituation-analysis.firebaseapp.com',
  projectId: 'cyjsituation-analysis',
  storageBucket: 'cyjsituation-analysis.firebasestorage.app',
  messagingSenderId: '139860745126',
  appId: '1:139860745126:web:4539176a4cf73ae4480d67',
};
const SUPPORTED_BRANDS = ['cyj', 'anniu', 'yibo'];
const CONFIRMATION = 'BOOTSTRAP_CURRENT_STORE_MONTH_REPORTS';

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
const apply = args.apply === true;
const accountId = String(args['account-id'] || await prompt('最高管理者帳號識別： ')).trim();
const deviceId = String(args['device-id'] || await prompt('Trusted Device ID： ')).trim();
const userName = String(args['user-name'] || accountId || '最高管理者').trim();
const credentialPassword = String(await prompt('目前最高管理者登入密碼（輸入不回顯）： ', { hidden: true }));

if (!accountId || !deviceId || !credentialPassword) {
  console.error('ABORT: accountId / deviceId / password 不可為空');
  process.exit(2);
}
if (apply) {
  const typed = await prompt(`正式寫入模式。請輸入 ${CONFIRMATION}： `);
  if (typed !== CONFIRMATION) {
    console.error('ABORT: confirmation 不符，未送出任何 Bootstrap apply');
    process.exit(3);
  }
}

const app = initializeApp(FIREBASE_CONFIG, `current-store-month-bootstrap-${Date.now()}`);
try {
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Firebase anonymous auth failed');

  const results = [];
  console.log(apply
    ? '=== CURRENT STORE-MONTH BOOTSTRAP APPLY ==='
    : '=== CURRENT STORE-MONTH BOOTSTRAP PLAN (READ-ONLY) ===');

  for (const brandId of brands) {
    process.stdout.write(`${brandId}: `);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          brandId,
          ...(yearMonth ? { yearMonth } : {}),
          action: apply ? 'apply' : 'plan',
          ...(apply ? { confirmation: CONFIRMATION } : {}),
          actor: { roleId: 'director', accountId, userName, deviceId, credentialPassword },
        }),
      });
      const result = await response.json().catch(() => ({}));
      results.push({ httpStatus: response.status, ...result });

      if (!response.ok || result?.ok === false) {
        console.log(`FAILED | ${result?.message || `HTTP ${response.status}`}`);
        continue;
      }
      if (apply) {
        console.log(
          `status=${result.status}`
          + ` raw=${result.parity?.raw?.rawDocCount ?? '?'}`
          + ` projection=${result.parity?.projection?.activeProjectionReportCount ?? '?'}`
          + ` parity=${result.parity?.comparison?.parity === true ? 'PASS' : 'NO'}`
          + ` projectionWrites=${result.apply?.projectionDocWrites ?? '?'}`
          + ` preservedNewer=${result.apply?.preservedNewerEvents ?? '?'}`
        );
      } else {
        console.log(
          `raw=${result.rawDocCount ?? '?'}`
          + ` stores=${result.storeCount ?? '?'}`
          + ` existingProjectionDocs=${result.existingProjectionDocCount ?? '?'}`
          + ` buckets=${result.bucketCount ?? '?'}`
          + ` estReads=${result.readEstimate?.estimatedDataReads ?? '?'}`
          + ` writes=0`
        );
      }
    } catch (error) {
      results.push({ ok: false, brandId, error: error.message });
      console.log(`FAILED | ${error.message}`);
    }
  }

  const outDir = path.join(os.homedir(), 'Downloads', 'WORK');
  fs.mkdirSync(outDir, { recursive: true });
  const mode = apply ? 'APPLY' : 'PLAN';
  const outPath = path.join(outDir, `DRCYJ_P2_A2_4B2C_CURRENT_STORE_MONTH_BOOTSTRAP_${mode}_${stamp()}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify({
    mode,
    applyRequested: apply,
    generatedAtText: new Date().toISOString(),
    endpoint: ENDPOINT,
    brandsRequested: brands,
    results,
  }, null, 2)}\n`, 'utf8');

  console.log(`\nREPORT=${outPath}`);
  console.log(`BOOTSTRAP_PERFORMED=${apply ? 'REQUESTED' : 'NO'}`);
  console.log('FRONTEND_CUTOVER=NO');
} finally {
  await deleteApp(app).catch(() => {});
}
