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
// datetime-local fields are always interpreted as Asia/Taipei wall-clock time,
// never as the workstation or server's potentially different timezone.
export function taipeiScheduleInput(instant = "") {
  if (!instant) return "";
  const d = new Date(instant);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Asia/Taipei", year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23",
  }).formatToParts(d);
  const val=(type)=>parts.find((part)=>part.type===type)?.value || "";
  return `${val("year")}-${val("month")}-${val("day")}T${val("hour")}:${val("minute")}`;
}

export function taipeiScheduleIso(localText = "") {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localText)) {
    throw new Error("請輸入有效的台北時間（年-月-日 時:分）");
  }
  const d=new Date(`${localText}:00+08:00`);
  if (!Number.isFinite(d.getTime()) || taipeiScheduleInput(d.toISOString())!==localText) {
    throw new Error("排程發布的日期或時間無效");
  }
  return d.toISOString();
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
    scheduledPublishAt: taipeiScheduleInput(p.scheduledPublishAt),
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
    draft.approvalPlan.scheduledPublishAt = taipeiScheduleIso(p.scheduledPublishAt || "");
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
