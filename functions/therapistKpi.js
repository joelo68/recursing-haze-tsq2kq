// functions/therapistKpi.js
// Batch 6A — canonical Therapist KPI sample / ranking semantics.
// Pure module: no Firestore reads, writes, listeners, queries, or polling.

const THERAPIST_KPI_SEMANTIC_VERSION = "therapist-kpi-v1";

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const isFiniteTherapistMetric = (value) => (
  typeof value === "number" && Number.isFinite(value)
);

const ratioOfTotalsOrNull = (numerator, denominator, multiplier = 1) => {
  const num = Number(numerator);
  const den = Number(denominator);
  const scale = Number(multiplier);
  if (!Number.isFinite(num) || !Number.isFinite(den) || !Number.isFinite(scale) || den <= 0) return null;
  return (num / den) * scale;
};

const buildTherapistSampleMetrics = (row = {}) => {
  const totalRevenue = toFiniteNumber(row.totalRevenue);
  const serviceCount = toFiniteNumber(row.serviceCount);
  const newCustomerRevenue = toFiniteNumber(row.newCustomerRevenue);
  const oldCustomerRevenue = toFiniteNumber(row.oldCustomerRevenue);
  const newCustomerCount = toFiniteNumber(row.newCustomerCount);
  const oldCustomerCount = toFiniteNumber(row.oldCustomerCount);
  const newCustomerClosings = toFiniteNumber(row.newCustomerClosings);
  const returnRevenue = toFiniteNumber(row.returnRevenue);

  const newRevenueMix = ratioOfTotalsOrNull(newCustomerRevenue, totalRevenue, 100);
  const oldRevenueMix = ratioOfTotalsOrNull(oldCustomerRevenue, totalRevenue, 100);

  return {
    ...row,
    totalRevenue,
    serviceCount,
    newCustomerRevenue,
    oldCustomerRevenue,
    newCustomerCount,
    oldCustomerCount,
    newCustomerClosings,
    returnRevenue,
    newClosingRate: ratioOfTotalsOrNull(newCustomerClosings, newCustomerCount, 100),
    newAsp: ratioOfTotalsOrNull(newCustomerRevenue, newCustomerCount),
    oldAsp: ratioOfTotalsOrNull(oldCustomerRevenue, oldCustomerCount),
    revenueMix: newRevenueMix === null || oldRevenueMix === null
      ? "N/A / N/A"
      : `${Math.round(newRevenueMix)}% / ${Math.round(oldRevenueMix)}%`,
  };
};

const getTherapistDangerCount = (totalPeers) => {
  const peers = Math.max(0, Math.floor(Number(totalPeers) || 0));
  if (peers <= 3) return 0;
  return Math.min(peers - 3, Math.max(1, Math.ceil(peers * 0.2)));
};

const getTherapistRankStatus = (rank, totalPeers) => {
  const peers = Math.max(0, Math.floor(Number(totalPeers) || 0));
  const normalizedRank = Math.floor(Number(rank) || 0);
  if (normalizedRank < 1 || normalizedRank > peers) return "NORMAL";
  if (normalizedRank <= Math.min(3, peers)) return "TOP";
  const dangerCount = getTherapistDangerCount(peers);
  return dangerCount > 0 && normalizedRank > peers - dangerCount ? "DANGER" : "NORMAL";
};

const applyTherapistRankingSemantics = (rows = []) => {
  const source = Array.isArray(rows) ? rows : [];
  const normalized = source.map((row, inputIndex) => ({
    ...buildTherapistSampleMetrics(row),
    __therapistInputIndex: inputIndex,
  }));

  normalized.sort((a, b) => {
    const revenueDiff = b.totalRevenue - a.totalRevenue;
    return revenueDiff !== 0 ? revenueDiff : a.__therapistInputIndex - b.__therapistInputIndex;
  });

  const totalPeers = normalized.length;
  return normalized.map((row, index) => {
    const { __therapistInputIndex, ...clean } = row;
    const rank = index + 1;
    const previous = index > 0 ? normalized[index - 1] : null;
    return {
      ...clean,
      rank,
      totalPeers,
      status: getTherapistRankStatus(rank, totalPeers),
      gapToNext: previous ? Math.max(0, previous.totalRevenue - clean.totalRevenue) : 0,
    };
  });
};

const buildTherapistAggregateMetrics = (rows = []) => {
  const source = Array.isArray(rows) ? rows : [];
  const grand = source.reduce((acc, row) => {
    acc.totalRevenue += toFiniteNumber(row.totalRevenue);
    acc.serviceCount += toFiniteNumber(row.serviceCount);
    acc.newCustomerRevenue += toFiniteNumber(row.newCustomerRevenue);
    acc.oldCustomerRevenue += toFiniteNumber(row.oldCustomerRevenue);
    acc.newCustomerCount += toFiniteNumber(row.newCustomerCount);
    acc.oldCustomerCount += toFiniteNumber(row.oldCustomerCount);
    acc.newCustomerClosings += toFiniteNumber(row.newCustomerClosings);
    acc.returnRevenue += toFiniteNumber(row.returnRevenue);
    return acc;
  }, {
    totalRevenue: 0,
    serviceCount: 0,
    newCustomerRevenue: 0,
    oldCustomerRevenue: 0,
    newCustomerCount: 0,
    oldCustomerCount: 0,
    newCustomerClosings: 0,
    returnRevenue: 0,
    count: source.length,
  });

  grand.regionalNewClosingRate = ratioOfTotalsOrNull(
    grand.newCustomerClosings,
    grand.newCustomerCount,
    100,
  );
  grand.regionalNewAsp = ratioOfTotalsOrNull(
    grand.newCustomerRevenue,
    grand.newCustomerCount,
  );
  grand.regionalOldAsp = ratioOfTotalsOrNull(
    grand.oldCustomerRevenue,
    grand.oldCustomerCount,
  );
  return grand;
};

const buildTherapistSummarySignature = (summary = {}) => {
  const rankings = applyTherapistRankingSemantics(
    Array.isArray(summary?.rankings) ? summary.rankings : [],
  );
  const grand = buildTherapistAggregateMetrics(rankings);
  return JSON.stringify({
    semanticVersion: THERAPIST_KPI_SEMANTIC_VERSION,
    rankings: rankings.map((row) => ({
      id: String(row.id || ""),
      name: String(row.name || ""),
      storeDisplay: String(row.storeDisplay || row.store || ""),
      totalRevenue: row.totalRevenue,
      newCustomerRevenue: row.newCustomerRevenue,
      oldCustomerRevenue: row.oldCustomerRevenue,
      newCustomerCount: row.newCustomerCount,
      oldCustomerCount: row.oldCustomerCount,
      newCustomerClosings: row.newCustomerClosings,
      newClosingRate: row.newClosingRate,
      newAsp: row.newAsp,
      oldAsp: row.oldAsp,
      rank: row.rank,
      status: row.status,
    })),
    grand: {
      totalRevenue: grand.totalRevenue,
      newCustomerRevenue: grand.newCustomerRevenue,
      oldCustomerRevenue: grand.oldCustomerRevenue,
      newCustomerCount: grand.newCustomerCount,
      oldCustomerCount: grand.oldCustomerCount,
      newCustomerClosings: grand.newCustomerClosings,
      regionalNewClosingRate: grand.regionalNewClosingRate,
      regionalNewAsp: grand.regionalNewAsp,
      regionalOldAsp: grand.regionalOldAsp,
    },
  });
};

module.exports = {
  THERAPIST_KPI_SEMANTIC_VERSION,
  isFiniteTherapistMetric,
  ratioOfTotalsOrNull,
  buildTherapistSampleMetrics,
  getTherapistDangerCount,
  getTherapistRankStatus,
  applyTherapistRankingSemantics,
  buildTherapistAggregateMetrics,
  buildTherapistSummarySignature,
};
