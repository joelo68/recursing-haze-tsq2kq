import {
  isAnnualPreSystemMonth,
  resolveAnnualHistoricalFormalTrust,
} from "./annualFormalConsumer.js";

export const ANNUAL_READ_MODE = Object.freeze({
  LOADING: "SUMMARY_LOADING",
  SUMMARY_ONLY: "SUMMARY_TRUSTED",
  FALLBACK_MONTHS: "FALLBACK_MONTHS",
});

const normalizeYear = (value) => {
  const text = String(value || "").trim();
  return /^\d{4}$/.test(text) ? text : "";
};

export const normalizeAnnualYearMonth = (value) => {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return "";
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  return `${match[1]}-${String(month).padStart(2, "0")}`;
};

export const buildAnnualAggregateYearMonthCandidates = (yearMonths = []) => {
  const candidates = [];
  const seen = new Set();
  (Array.isArray(yearMonths) ? yearMonths : []).forEach((value) => {
    const canonical = normalizeAnnualYearMonth(value);
    if (!canonical) return;
    const [year, monthText] = canonical.split("-");
    const variants = [canonical, `${year}-${Number(monthText)}`];
    variants.forEach((variant) => {
      if (!seen.has(variant)) {
        seen.add(variant);
        candidates.push(variant);
      }
    });
  });
  return candidates;
};

const makeYearMonths = (year) => Array.from(
  { length: 12 },
  (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`
);

const indexSummaries = (rows = []) => {
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const yearMonth = normalizeAnnualYearMonth(row?.yearMonth || row?.id);
    if (yearMonth) map[yearMonth] = row;
  });
  return map;
};

export const resolveAnnualReadPlan = ({
  selectedYear = "",
  currentYearMonth = "",
  brandId = "",
  dashboardSummaries = [],
  summaryStatusMap = {},
  summaryLoadState = {},
} = {}) => {
  const year = normalizeYear(selectedYear);
  const currentYm = normalizeAnnualYearMonth(currentYearMonth);
  const expectedBrand = String(brandId || "").trim().toLowerCase();
  const loadBrand = String(summaryLoadState?.brandId || "").trim().toLowerCase();
  const loadYear = normalizeYear(summaryLoadState?.year);

  const anchored = Boolean(year && expectedBrand && loadBrand === expectedBrand && loadYear === year);
  const ready = anchored
    && summaryLoadState?.dashboardReady === true
    && summaryLoadState?.flagsReady === true;

  if (!ready) {
    return {
      mode: ANNUAL_READ_MODE.LOADING,
      ready: false,
      fallbackYearMonths: [],
      reasonsByMonth: {},
    };
  }

  const months = makeYearMonths(year);
  const summariesByMonth = indexSummaries(dashboardSummaries);
  const reasonsByMonth = {};
  const fallbackYearMonths = [];
  const hasLoadError = Boolean(summaryLoadState?.dashboardError || summaryLoadState?.flagsError);

  months.forEach((yearMonth) => {
    if (isAnnualPreSystemMonth(expectedBrand, yearMonth)) {
      reasonsByMonth[yearMonth] = "PRE_SYSTEM_SKIP";
      return;
    }

    if (!currentYm || yearMonth > currentYm) {
      reasonsByMonth[yearMonth] = "FUTURE_SKIP";
      return;
    }

    if (yearMonth === currentYm) {
      fallbackYearMonths.push(yearMonth);
      reasonsByMonth[yearMonth] = "CURRENT_MONTH_FALLBACK";
      return;
    }

    if (hasLoadError) {
      fallbackYearMonths.push(yearMonth);
      reasonsByMonth[yearMonth] = "SUMMARY_LOAD_ERROR";
      return;
    }

    const trust = resolveAnnualHistoricalFormalTrust({
      yearMonth,
      currentYearMonth: currentYm,
      brandId: expectedBrand,
      dashboardSummary: summariesByMonth[yearMonth] || null,
      summaryFlag: summaryStatusMap?.[yearMonth] || null,
    });

    if (trust.preSystemSkip) {
      reasonsByMonth[yearMonth] = "PRE_SYSTEM_SKIP";
      return;
    }

    if (trust.trusted) {
      reasonsByMonth[yearMonth] = trust.reason || "VERIFIED_FORMAL_SUMMARY";
      return;
    }

    fallbackYearMonths.push(yearMonth);
    reasonsByMonth[yearMonth] = trust.reason || "HISTORICAL_DETAIL_FALLBACK";
  });

  return {
    mode: fallbackYearMonths.length > 0
      ? ANNUAL_READ_MODE.FALLBACK_MONTHS
      : ANNUAL_READ_MODE.SUMMARY_ONLY,
    ready: true,
    fallbackYearMonths,
    reasonsByMonth,
  };
};
