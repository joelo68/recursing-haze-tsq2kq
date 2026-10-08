// Phase 2A-4R2B UI-only shape guard; backend remains the security authority.
export const REVIEW_DECISIONS=Object.freeze({VERIFIED:"verified",FLAGGED:"flagged"});
export const REVIEW_REASONS=Object.freeze([
  {value:"AMOUNT_RECHECK",label:"金額待核對"},
  {value:"OWNER_RECHECK",label:"歸屬人員待核對"},
  {value:"MISSING_EVIDENCE",label:"憑證資料不足"},
  {value:"OTHER",label:"其他（待核對）"},
]);
export function checkedReviewPage(page,{brandId,reportDate,storeName}={}){
  if(!page||page.ok!==true||page.brandId!==brandId||page.reportDate!==reportDate||
     typeof page.storeCore!=="string"||!page.storeCore||!Array.isArray(page.candidates)||
     page.candidates.length>12||page.maxCandidates!==12||typeof page.hasMore!=="boolean"||
     (page.hasMore?!page.nextCursor:page.nextCursor!==null))throw new Error("覆核候選清單的範圍或分頁資料不符");
  const ids=new Set();
  for(const row of page.candidates){
    const key=[row.accountId,row.campaignId,row.versionId,row.reportDate].join("|");
    if(!row.accountId||!row.campaignId||!row.versionId||row.reportDate!==reportDate||ids.has(key)||
       row.formalRevenueDelta!==0||!Number.isInteger(row.attributionRevision)||row.attributionRevision<1||
       !["HAS_SALES","CONFIRMED_ZERO"].includes(row.status)||
       (row.status==="CONFIRMED_ZERO" && (row.saleCount!==0||row.attributedAmount!==0))||
       (row.status==="HAS_SALES" && !(row.saleCount>0&&row.attributedAmount>0)))
      throw new Error("覆核候選資料的版本或營收契約不符");
    ids.add(key);
  }
  if(!storeName)throw new Error("請先選擇授權門市");
  return page;
}
export function reviewFromInspect({inspect,expected}){
  if(!inspect||inspect.ok!==true||!inspect.subject||!expected||
     inspect.subject.brandId!==expected.brandId||
     inspect.subject.accountId!==expected.accountId||
     inspect.subject.campaignId!==expected.campaignId||
     inspect.subject.versionId!==expected.versionId||
     inspect.subject.reportDate!==expected.reportDate||
     inspect.formalRevenueDelta!==0||
     !["HAS_SALES","CONFIRMED_ZERO"].includes(inspect.status)||
     !Number.isSafeInteger(inspect.revision)||inspect.revision<1||
     typeof inspect.reportUpdateVersion!=="string"||!/^[0-9]{10,}:[0-9]{9}$/.test(inspect.reportUpdateVersion)||
     !inspect.review||!Number.isSafeInteger(inspect.review.reviewRevision)||inspect.review.reviewRevision<0)
     throw new Error("單筆覆核檢視資料已過期或契約不符，請重新取得");
  return {expectedAttributionRevision:inspect.revision,
    expectedReportUpdateVersion:inspect.reportUpdateVersion,
    expectedReviewRevision:inspect.review.reviewRevision};
}
