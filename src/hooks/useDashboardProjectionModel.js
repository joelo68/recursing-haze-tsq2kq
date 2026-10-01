import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { PROJECTION_MODEL_DOC_ID } from "../utils/projectionModelConsumer.js";

const makeProjectionModelState = ({
  brandId = "",
  modelMonth = "",
  ready = false,
  data = null,
  error = null,
} = {}) => ({
  brandId,
  modelMonth,
  ready,
  data,
  error,
});

export function useDashboardProjectionModel({
  getCollectionPath,
  brandId: inputBrandId,
  selectedYearMonth,
  isSelectedCurrentMonth,
} = {}) {
  const [projectionModelState, setProjectionModelState] = useState(
    makeProjectionModelState()
  );

  useEffect(() => {
    const brandId = String(inputBrandId || "").toLowerCase();

    if (!getCollectionPath || !selectedYearMonth || !isSelectedCurrentMonth || !brandId) {
      setProjectionModelState(makeProjectionModelState({
        brandId,
        modelMonth: selectedYearMonth,
        ready: true,
      }));
      return undefined;
    }

    let cancelled = false;

    setProjectionModelState(makeProjectionModelState({
      brandId,
      modelMonth: selectedYearMonth,
      ready: false,
    }));

    const loadProjectionModel = async () => {
      try {
        const modelRef = doc(getCollectionPath("projection_models"), PROJECTION_MODEL_DOC_ID);
        const snap = await getDoc(modelRef);
        if (cancelled) return;

        setProjectionModelState(makeProjectionModelState({
          brandId,
          modelMonth: selectedYearMonth,
          ready: true,
          data: snap.exists() ? { id: snap.id, ...snap.data() } : null,
        }));
      } catch (error) {
        if (cancelled) return;

        console.warn("Dashboard Projection Model 讀取失敗，改用本月節奏 fallback：", error);
        setProjectionModelState(makeProjectionModelState({
          brandId,
          modelMonth: selectedYearMonth,
          ready: true,
          data: null,
          error,
        }));
      }
    };

    loadProjectionModel();

    return () => {
      cancelled = true;
    };
  }, [getCollectionPath, inputBrandId, selectedYearMonth, isSelectedCurrentMonth]);

  return projectionModelState;
}
