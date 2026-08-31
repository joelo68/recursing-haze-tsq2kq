import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';

const ENDPOINT = 'https://us-central1-cyjsituation-analysis.cloudfunctions.net/normalizeLegacyZeroTargetPlaceholders';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM',
  authDomain: 'cyjsituation-analysis.firebaseapp.com',
  projectId: 'cyjsituation-analysis',
  storageBucket: 'cyjsituation-analysis.firebasestorage.app',
  messagingSenderId: '139860745126',
  appId: '1:139860745126:web:4539176a4cf73ae4480d67',
};
const EXECUTION_CONFIRMATION = 'BATCH5E1A_DELETE_27_YIBO_LEGACY_ZERO_PLACEHOLDERS';

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

function prompt(question, { hidden = false } = {}) {
  if (!hidden) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
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
  const now = new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

const args = parseArgs(process.argv.slice(2));
const requestedMode = String(args.mode || (args.execute ? 'execute' : 'dry_run')).trim().toLowerCase();
const mode = requestedMode === 'dry-run' ? 'dry_run' : requestedMode;

if (!['dry_run', 'execute', 'verify'].includes(mode)) {
  console.error('ABORT: --mode must be dry-run, execute, or verify');
  process.exit(2);
}

if (String(args.brand || 'yibo').trim().toLowerCase() !== 'yibo') {
  console.error('ABORT: Batch 5E-1A is intentionally scoped to --brand yibo only');
  process.exit(2);
}

if (mode === 'execute') {
  if (args.execute !== true) {
    console.error('ABORT: execute mode additionally requires the explicit --execute flag');
    process.exit(2);
  }
  if (String(args.confirm || '') !== EXECUTION_CONFIRMATION) {
    console.error(`ABORT: execute mode requires --confirm '${EXECUTION_CONFIRMATION}'`);
    process.exit(2);
  }
}

const accountId = String(args['account-id'] || await prompt('最高管理者帳號識別： ')).trim();
const deviceId = String(args['device-id'] || await prompt('Trusted Device ID： ')).trim();
const userName = String(args['user-name'] || accountId || '最高管理者').trim();
const credentialPassword = String(await prompt('目前最高管理者登入密碼（輸入不回顯）： ', { hidden: true }));

if (!accountId || !deviceId || !credentialPassword) {
  console.error('ABORT: accountId / deviceId / password 不可為空');
  process.exit(2);
}

const app = initializeApp(FIREBASE_CONFIG, `batch5e1a-zero-normalization-${Date.now()}`);
const auth = getAuth(app);
await signInAnonymously(auth);
const idToken = await auth.currentUser?.getIdToken();
if (!idToken) throw new Error('Firebase anonymous auth failed');

const actionLabel = mode === 'dry_run' ? 'Dry-running' : mode === 'verify' ? 'Verifying' : 'EXECUTING';
process.stdout.write(`${actionLabel} Batch 5E-1A yibo placeholder normalization ... `);

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  },
  body: JSON.stringify({
    brandId: 'yibo',
    mode,
    execute: mode === 'execute',
    confirmation: mode === 'execute' ? EXECUTION_CONFIRMATION : '',
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

const outDir = path.join(os.homedir(), 'Downloads', 'work');
fs.mkdirSync(outDir, { recursive: true });
const suffix = mode === 'dry_run' ? 'DRYRUN' : mode.toUpperCase();
const outPath = path.join(outDir, `DRCYJ_BATCH5E1A_PLACEHOLDER_NORMALIZATION_${suffix}_${stamp()}.json`);
const payload = {
  generatedAtText: new Date().toISOString(),
  endpoint: ENDPOINT,
  brandId: 'yibo',
  mode,
  httpStatus: response.status,
  result,
};
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

if (!response.ok || result?.ok === false) {
  console.log(`FAILED | ${result?.message || `HTTP ${response.status}`}`);
  console.log(`Saved: ${outPath}`);
  process.exitCode = 3;
} else if (mode === 'dry_run') {
  console.log(`OK | canExecute=${result?.canExecute === true} | manifest=${result?.manifestCount || 0} | unsafeSummaryMonths=${result?.unsafeSummaryMonths?.length || 0}`);
  console.log(`Saved: ${outPath}`);
  console.log('Firestore writes: 0 (dry-run contract)');
} else if (mode === 'verify') {
  console.log(`OK | verified=${result?.verified === true} | remainingZeroDocs=${result?.remainingExplicitZeroDocIds?.length || 0}`);
  console.log(`Saved: ${outPath}`);
  console.log('Firestore writes: 0 (verify contract)');
} else {
  console.log(`OK | committed=${result?.committed === true} | deletedDocs=${result?.deletedDocIds?.length || 0}`);
  console.log(`Saved: ${outPath}`);
  console.log('Production mutation committed. Run verify ONCE after Target Coverage triggers have completed.');
}
