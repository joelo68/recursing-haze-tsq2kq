// Phase 1C editor-only normalization. Backend remains the pricing/approval authority.
export const emptyDraft = () => ({
  title: "", shortSummary: "", startDate: "", endDate: "", storeScope: "all", stores: [],
  customerTypes: [], tags: [], sellingPoints: [], suitableFor: [], notSuitableFor: [],
  discountRules: [], restrictions: [], salesTalk: "", faq: [],
  packages: [{ packageId: "package_1", name: "", salePrice: "", originalPrice: "", items: [
    { itemId: "course_1", type: "course", name: "", quantity: 1, attributedAmount: "" },
  ] }],
  approvalPlan: { mode: "any", releaseMode: "manual_after_approval", allowCreatorApproval: false,
    selectors: [], steps: [], scheduledPublishAt: "" },
});
const asLines = (list = []) => Array.isArray(list) ? list.join("\n") : "";
const splitLines = (value) => String(value || "").split(/\r?\n/).map((x)=>x.trim()).filter(Boolean);
const uiLists = ["stores", "customerTypes", "tags", "sellingPoints", "suitableFor", "notSuitableFor", "discountRules", "restrictions"];
export const selectorsToText = (selectors = []) => (Array.isArray(selectors) ? selectors : []).map((x) =>
  x.type === "group" ? `@${x.groupId}` : `${x.account?.roleId || x.roleId}:${x.account?.accountId || x.accountId}`
).join("\n");
export function textToSelectors(value) {
  const tokens = splitLines(value);
  if (tokens.length > 100) throw new Error("核准人員／群組不可超過 100 筆");
  return tokens.map((token) => {
    if (/^@[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(token)) return { type: "group", groupId: token.slice(1) };
    const match = token.match(/^([A-Za-z0-9_-]{1,40}):([^:\s]{1,160})$/);
    if (!match) throw new Error(`核准對象格式錯誤：${token}，應為 role:account 或 @群組`);
    return { type: "account", account: { roleId: match[1], accountId: match[2] } };
  });
}
export function draftToEditor(draft = {}) {
  const normalized = { ...emptyDraft(), ...draft };
  for (const key of uiLists) normalized[key] = asLines(draft[key]);
  normalized.faq = (draft.faq || []).map((f)=>({ ...f }));
  normalized.packages = (draft.packages || []).map((p)=>({ ...p, items: (p.items || []).map((i)=>({...i})) }));
  const p=draft.approvalPlan || {};
  normalized.approvalPlan = { ...emptyDraft().approvalPlan, ...p,
    selectorText: selectorsToText(p.selectors),
    steps: (p.steps || []).map((s)=>({ ...s, selectorText: selectorsToText(s.selectors) })),
    scheduledPublishAt: p.scheduledPublishAt ? (() => {
      const d = new Date(p.scheduledPublishAt);
      if (!Number.isFinite(d.getTime())) return "";
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
      return local.toISOString().slice(0,16);
    })() : "",
  };
  return normalized;
}
export function editorToDraft(editor = {}) {
  const draft={...editor};
  for (const key of uiLists) draft[key]=splitLines(editor[key]);
  draft.packages=(editor.packages || []).map((p)=>({ ...p,
    salePrice:Number(p.salePrice),
    originalPrice:p.originalPrice === "" || p.originalPrice == null ? null : Number(p.originalPrice),
    items:(p.items || []).map((i)=>({...i,quantity:Number(i.quantity),attributedAmount:Number(i.attributedAmount)})),
  }));
  draft.faq=(editor.faq || []).filter((f)=>String(f.question || "").trim() && String(f.answer || "").trim());
  const p=editor.approvalPlan || {};
  draft.approvalPlan={mode:p.mode,releaseMode:p.releaseMode,allowCreatorApproval:p.allowCreatorApproval === true};
  if (p.releaseMode === "scheduled_after_approval") {
    const timestamp = Date.parse(p.scheduledPublishAt || "");
    if (!Number.isFinite(timestamp)) throw new Error("請輸入有效的排程發布日期／時間");
    draft.approvalPlan.scheduledPublishAt = new Date(timestamp).toISOString();
  }
  if (["any", "all"].includes(p.mode)) draft.approvalPlan.selectors=textToSelectors(p.selectorText);
  if (["sequential", "custom"].includes(p.mode)) draft.approvalPlan.steps=(p.steps || []).map((s)=>({
    stepId:s.stepId,label:s.label,quorum:s.quorum,selectors:textToSelectors(s.selectorText),
  }));
  return draft;
}
export function pricingWarnings(editor = {}) {
  const result=[];
  for (const pkg of editor.packages || []) {
    const price=Number(pkg.salePrice);
    const sum=(pkg.items || []).reduce((acc,item)=>acc + Number(item.attributedAmount || 0),0);
    if (!Number.isFinite(price) || !Number.isInteger(price) || price <= 0) result.push(`${pkg.name || pkg.packageId}：正式售價必須是正整數`);
    if (sum!==price) result.push(`${pkg.name || pkg.packageId}：歸屬合計 ${sum} ≠ 正式售價 ${price}`);
  }
  return result;
}
