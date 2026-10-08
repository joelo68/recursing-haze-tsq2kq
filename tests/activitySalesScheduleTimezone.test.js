import test from "node:test";
import assert from "node:assert/strict";
import {taipeiScheduleInput,taipeiScheduleIso,draftToEditor,editorToDraft} from "../src/utils/activitySalesEditor.js";

test("scheduled datetime-local roundtrips in Taipei irrespective of workstation TZ",()=>{
  assert.equal(taipeiScheduleIso("2026-10-08T10:30"),"2026-10-08T02:30:00.000Z");
  assert.equal(taipeiScheduleInput("2026-10-08T02:30:00.000Z"),"2026-10-08T10:30");
  const plan={mode:"none",releaseMode:"scheduled_after_approval",
    scheduledPublishAt:"2026-10-08T02:30:00.000Z"};
  const editor=draftToEditor({approvalPlan:plan});
  assert.equal(editor.approvalPlan.scheduledPublishAt,"2026-10-08T10:30");
  assert.equal(editorToDraft(editor).approvalPlan.scheduledPublishAt,plan.scheduledPublishAt);
});

test("invalid Taipei wall time fails without ambiguous Date.parse fallback",()=>{
  assert.throws(()=>taipeiScheduleIso("2026-02-30T10:00"));
  assert.throws(()=>taipeiScheduleIso("2026-10-08T28:00"));
});
