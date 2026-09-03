import { KPI_VALUE_STATUS } from "./kpiContracts.js";

const isValidFormalStatus = (status) => (
  status === KPI_VALUE_STATUS.VALID || status === KPI_VALUE_STATUS.VALID_ZERO
);

const sumReported = (rows, key) => rows.reduce((sum, row) => sum + Number(row?.[key] || 0), 0);

export const buildDailyObservedTotals = (rows = []) => {
  const list = Array.isArray(rows) ? rows : [];
  const reportedRows = list.filter((row) => row?.isReported === true);
  const hasReportedData = reportedRows.length > 0;
  const dataComplete = list.length > 0 && reportedRows.length === list.length;
  const cashObservedValid = hasReportedData && reportedRows.every((row) => isValidFormalStatus(row?.cashStatus));
  const accrualObservedValid = hasReportedData && reportedRows.every((row) => isValidFormalStatus(row?.accrualStatus));

  return {
    totals: {
      cash: cashObservedValid ? sumReported(reportedRows, "cash") : null,
      accrual: accrualObservedValid ? sumReported(reportedRows, "accrual") : null,
      traffic: hasReportedData ? sumReported(reportedRows, "traffic") : null,
      newCustomers: hasReportedData ? sumReported(reportedRows, "newCustomers") : null,
      skincare: hasReportedData ? sumReported(reportedRows, "skincareSales") : null,
    },
    reportedCount: reportedRows.length,
    totalCount: list.length,
    dataComplete,
    hasReportedData,
  };
};

export { isValidFormalStatus as isDailyObservedFormalStatus };
