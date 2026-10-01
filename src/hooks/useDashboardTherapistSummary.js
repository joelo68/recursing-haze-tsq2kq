import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

const makeTherapistSummaryState = ({
  brandId = "",
  yearMonth = "",
  data = null,
  ready = true,
  error = null,
} = {}) => ({
  brandId,
  yearMonth,
  data,
  ready,
  error,
});

export function useDashboardTherapistSummary({
  getCollectionPath,
  brandId: inputBrandId,
  selectedYearMonth,
  isSelectedCurrentMonth,
  isTherapistModuleEnabled,
  viewMode,
} = {}) {
  const [state, setState] = useState(makeTherapistSummaryState());

  useEffect(() => {
    const brandId = String(inputBrandId || "").trim().toLowerCase();

    if (
      !getCollectionPath ||
      !brandId ||
      !selectedYearMonth ||
      isSelectedCurrentMonth ||
      !isTherapistModuleEnabled ||
      viewMode !== "therapist"
    ) {
      setState(makeTherapistSummaryState({
        brandId,
        yearMonth: selectedYearMonth,
        ready: true,
      }));
      return undefined;
    }

    let cancelled = false;

    setState(makeTherapistSummaryState({
      brandId,
      yearMonth: selectedYearMonth,
      ready: false,
    }));

    const unsubscribe = onSnapshot(
      doc(getCollectionPath("therapist_summary"), selectedYearMonth),
      (snap) => {
        if (cancelled) return;

        setState(makeTherapistSummaryState({
          brandId,
          yearMonth: selectedYearMonth,
          data: snap.exists() ? { id: snap.id, ...snap.data() } : null,
          ready: true,
        }));
      },
      (error) => {
        if (cancelled) return;

        console.warn("Dashboard therapist_summary 監聽失敗，將使用管理師明細 fallback：", error);
        setState(makeTherapistSummaryState({
          brandId,
          yearMonth: selectedYearMonth,
          ready: true,
          error,
        }));
      }
    );

    return () => {
      cancelled = true;
      try {
        unsubscribe?.();
      } catch (error) {
        console.warn("therapist_summary listener cleanup failed", error);
      }
    };
  }, [
    getCollectionPath,
    inputBrandId,
    selectedYearMonth,
    isSelectedCurrentMonth,
    isTherapistModuleEnabled,
    viewMode,
  ]);

  return state;
}
