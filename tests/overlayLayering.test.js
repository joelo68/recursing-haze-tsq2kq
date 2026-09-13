import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const sharedUI = read("src/components/SharedUI.jsx");
const therapistManager = read("src/components/TherapistManagerView.jsx");

const readZ = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match, `${label} z-index contract missing`);
  return Number(match[1]);
};

test("global overlay stack keeps drawer below reveal modal, confirm modal and toast", () => {
  const drawerZ = readZ(
    therapistManager,
    /fixed inset-0 z-\[(\d+)\] 2xl:hidden/,
    "therapist drawer"
  );
  const revealZ = readZ(
    therapistManager,
    /fixed inset-0 z-\[(\d+)\] flex items-center justify-center bg-stone-900\/40/,
    "credential reveal"
  );
  const confirmZ = readZ(
    sharedUI,
    /backdrop-blur-sm z-\[(\d+)\] flex items-center justify-center p-4/,
    "global confirm modal"
  );
  const toastZ = readZ(
    sharedUI,
    /gap-3 z-\[(\d+)\] animate-in/,
    "global toast"
  );

  assert.equal(drawerZ, 9999);
  assert.equal(revealZ, 10000);
  assert.ok(confirmZ > revealZ, "global confirm modal must render above feature drawers/modals");
  assert.ok(toastZ > confirmZ, "global toast must remain visible above active overlays");
});

test("overlay fix changes presentation only and introduces no data-read primitive", () => {
  assert.doesNotMatch(sharedUI, /firebase|firestore|onSnapshot\s*\(|getDocs\s*\(|setInterval\s*\(/i);
  assert.match(sharedUI, /z-\[10020\]/);
  assert.match(sharedUI, /z-\[10010\]/);
});
