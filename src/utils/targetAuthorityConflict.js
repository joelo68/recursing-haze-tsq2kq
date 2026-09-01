import {
  KPI_VALUE_STATUS,
  validBaseTarget,
  validChallengeTarget,
} from "./kpiContracts.js";

export const TARGET_AUTHORITY_CONFLICT_STATUS = "AUTHORITY_CONFLICT";

const normalizeResult = (result = {}) => ({
  status: String(result?.status || KPI_VALUE_STATUS.DATA_INVALID),
  valid: result?.valid === true,
  value: result?.valid === true && Number.isFinite(Number(result?.value))
    ? Number(result.value)
    : null,
  configured: result?.configured === true,
});

export const buildTargetAuthoritySemanticSnapshot = (row = {}) => ({
  cashTarget: normalizeResult(validBaseTarget(row?.cashTarget)),
  accrualTarget: normalizeResult(validBaseTarget(row?.accrualTarget)),
  challengeCashTarget: normalizeResult(validChallengeTarget(row?.cashTarget, row?.challengeCashTarget)),
  challengeAccrualTarget: normalizeResult(validChallengeTarget(row?.accrualTarget, row?.challengeAccrualTarget)),
});

export const buildTargetAuthoritySemanticSignature = (row = {}) => (
  JSON.stringify(buildTargetAuthoritySemanticSnapshot(row))
);

const collectSourceDocIds = (...rows) => {
  const ids = new Set();
  rows.filter(Boolean).forEach((row) => {
    const conflictIds = Array.isArray(row?.conflictSourceDocIds)
      ? row.conflictSourceDocIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (conflictIds.length > 0) {
      conflictIds.forEach((id) => ids.add(id));
      return;
    }
    const own = String(row?.sourceDocId || row?.id || "").trim();
    if (own) ids.add(own);
  });
  return [...ids].sort((a, b) => a.localeCompare(b, "zh-Hant"));
};

export const buildTargetAuthorityConflictRow = (current = {}, incoming = {}, options = {}) => {
  const sourceDocIds = collectSourceDocIds(current, incoming);
  const canonicalTargetId = String(
    options?.canonicalTargetId || current?.canonicalTargetId || incoming?.canonicalTargetId || ""
  ).trim();
  const storeName = String(options?.storeName || current?.storeName || incoming?.storeName || "").trim();

  return {
    storeName,
    cashTarget: null,
    accrualTarget: null,
    challengeCashTarget: null,
    challengeAccrualTarget: null,
    authorityConflict: true,
    authorityStatus: TARGET_AUTHORITY_CONFLICT_STATUS,
    status: TARGET_AUTHORITY_CONFLICT_STATUS,
    conflictSourceDocIds: sourceDocIds,
    canonicalTargetId,
    sourceDocId: sourceDocIds.join("|"),
    isCanonicalSource: true,
  };
};

export const resolveTargetAuthorityConflict = (current = null, incoming = null, options = {}) => {
  if (!current || !incoming) return null;

  const currentAuthoritative = options?.currentAuthoritative === true;
  const incomingAuthoritative = options?.incomingAuthoritative === true;

  if (current?.authorityConflict === true || current?.status === TARGET_AUTHORITY_CONFLICT_STATUS) {
    return buildTargetAuthorityConflictRow(current, incomingAuthoritative ? incoming : null, options);
  }
  if (incoming?.authorityConflict === true || incoming?.status === TARGET_AUTHORITY_CONFLICT_STATUS) {
    return buildTargetAuthorityConflictRow(currentAuthoritative ? current : null, incoming, options);
  }

  if (!currentAuthoritative || !incomingAuthoritative) return null;
  if (buildTargetAuthoritySemanticSignature(current) === buildTargetAuthoritySemanticSignature(incoming)) return null;

  return buildTargetAuthorityConflictRow(current, incoming, options);
};
