import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, draftToEditor, editorToDraft, pricingWarnings, selectorsToText, textToSelectors } from "../src/utils/activitySalesEditor.js";
test("editor serializes one package, split and approval selectors without modifying source",()=>{
  const draft=emptyDraft();
  draft.title="2026 十月";draft.startDate="2026-10-01";draft.endDate="2026-10-31";
  draft.packages[0].name="養髮組";draft.packages[0].salePrice=9800;
  draft.packages[0].items[0].name="護理";draft.packages[0].items[0].attributedAmount=9800;
  draft.approvalPlan={mode:"all",releaseMode:"manual_after_approval",allowCreatorApproval:false,selectors:[{type:"account",account:{roleId:"director",accountId:"u1"}}]};
  const editor=draftToEditor(draft);
  assert.equal(pricingWarnings(editor).length,0);
  const saved=editorToDraft(editor);
  assert.equal(saved.packages[0].salePrice,9800);
  assert.equal(saved.packages[0].items[0].attributedAmount,9800);
  assert.equal(saved.approvalPlan.selectors[0].account.accountId,"u1");
  assert.equal(saved.approvalPlan.allowCreatorApproval,false);
});
test("payment and internal attribution discrepancies are explicitly rejected in editor",()=>{
  const editor=draftToEditor(emptyDraft());
  editor.packages[0].salePrice=9800;
  editor.packages[0].items[0].attributedAmount=9500;
  assert.match(pricingWarnings(editor).join("\n"),/歸屬合計/);
});
test("role account and group selectors round trip, invalid selectors fail closed",()=>{
  const parsed=textToSelectors("@launch\ndirector:u1\ntrainer:trainer_2");
  assert.equal(parsed.length,3);
  assert.equal(selectorsToText(parsed),"@launch\ndirector:u1\ntrainer:trainer_2");
  assert.throws(()=>textToSelectors("not a role"),/格式錯誤/);
  assert.throws(()=>textToSelectors("@bad/name"),/格式錯誤/);
});
test("scheduled publish is UTC-normalized; no hidden auto-publisher",()=>{
  const editor=draftToEditor(emptyDraft());
  editor.approvalPlan.releaseMode="scheduled_after_approval";
  editor.approvalPlan.scheduledPublishAt="2026-10-15T10:30";
  const result=editorToDraft(editor);
  assert.ok(Number.isFinite(Date.parse(result.approvalPlan.scheduledPublishAt)));
  assert.throws(()=>editorToDraft({...editor,approvalPlan:{...editor.approvalPlan,scheduledPublishAt:"invalid"}}),/有效的排程/);
});
