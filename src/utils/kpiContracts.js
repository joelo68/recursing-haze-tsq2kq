export const KPI_CONTRACT_VERSION = "kpi-contract-v1";

export const KPI_VALUE_STATUS = Object.freeze({
  VALID: "VALID",
  VALID_ZERO: "VALID_ZERO",
  N_A: "N_A",
  FIELD_MISSING: "FIELD_MISSING",
  DATA_INVALID: "DATA_INVALID",
  TARGET_NOT_SET: "TARGET_NOT_SET",
  CHALLENGE_NOT_SET: "CHALLENGE_NOT_SET",
});

const normalizeNumericInput = (value) => {
  if (value === null || value === undefined) {
    return { status: KPI_VALUE_STATUS.FIELD_MISSING, value: null };
  }
  if (typeof value === "boolean") {
    return { status: KPI_VALUE_STATUS.DATA_INVALID, value: null };
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { status: KPI_VALUE_STATUS.FIELD_MISSING, value: null };
    const normalized = text.replace(/,/g, "");
    if (!normalized || !Number.isFinite(Number(normalized))) {
      return { status: KPI_VALUE_STATUS.DATA_INVALID, value: null };
    }
    const numberValue = Number(normalized);
    return {
      status: numberValue === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
      value: numberValue,
    };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { status: KPI_VALUE_STATUS.DATA_INVALID, value: null };
  }
  return {
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
    value,
  };
};

const isNumericValid = (result) => (
  result?.status === KPI_VALUE_STATUS.VALID || result?.status === KPI_VALUE_STATUS.VALID_ZERO
);

const propagateNumericFailure = (results = []) => {
  if (results.some((item) => item?.status === KPI_VALUE_STATUS.DATA_INVALID)) {
    return KPI_VALUE_STATUS.DATA_INVALID;
  }
  if (results.some((item) => item?.status === KPI_VALUE_STATUS.FIELD_MISSING)) {
    return KPI_VALUE_STATUS.FIELD_MISSING;
  }
  return KPI_VALUE_STATUS.DATA_INVALID;
};

export const inspectKpiNumber = (value) => normalizeNumericInput(value);

export const normalizeKpiBrandId = (value = "") => {
  const raw = typeof value === "object" && value
    ? (value.id || value.brandId || value.value || value.label || "")
    : value;
  const text = String(raw || "").trim().toLowerCase();
  if (["cyj", "drcyj", "default", "default-app-id"].includes(text)) return "cyj";
  if (["anniu", "anew", "安妞"].includes(text)) return "anniu";
  if (["yibo", "伊啵"].includes(text)) return "yibo";
  return "";
};

export const formalNetCash = (cash, refund, skincareRefund) => {
  const cashResult = normalizeNumericInput(cash);
  const refundResult = normalizeNumericInput(refund);
  const skincareRefundResult = normalizeNumericInput(skincareRefund);
  const inputs = [cashResult, refundResult, skincareRefundResult];

  if (!inputs.every(isNumericValid)) {
    return {
      status: propagateNumericFailure(inputs),
      value: null,
      components: {
        cash: cashResult,
        refund: refundResult,
        skincareRefund: skincareRefundResult,
      },
    };
  }

  const value = cashResult.value - refundResult.value - skincareRefundResult.value;
  return {
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
    value,
    components: {
      cash: cashResult.value,
      refund: refundResult.value,
      skincareRefund: skincareRefundResult.value,
    },
  };
};

export const formalAccrual = (brandId, accrual, operationalAccrual) => {
  const normalizedBrandId = normalizeKpiBrandId(brandId);
  if (!normalizedBrandId) {
    return {
      status: KPI_VALUE_STATUS.DATA_INVALID,
      value: null,
      brandId: "",
      sourceField: "",
    };
  }

  const sourceField = normalizedBrandId === "anniu" ? "operationalAccrual" : "accrual";
  const sourceValue = sourceField === "operationalAccrual" ? operationalAccrual : accrual;
  const result = normalizeNumericInput(sourceValue);

  return {
    status: result.status,
    value: isNumericValid(result) ? result.value : null,
    brandId: normalizedBrandId,
    sourceField,
  };
};

export const validBaseTarget = (value) => {
  const result = normalizeNumericInput(value);
  if (result.status === KPI_VALUE_STATUS.FIELD_MISSING || result.status === KPI_VALUE_STATUS.VALID_ZERO) {
    return { status: KPI_VALUE_STATUS.TARGET_NOT_SET, valid: false, value: null };
  }
  if (result.status === KPI_VALUE_STATUS.DATA_INVALID || result.value < 0) {
    return { status: KPI_VALUE_STATUS.DATA_INVALID, valid: false, value: null };
  }
  return { status: KPI_VALUE_STATUS.VALID, valid: true, value: result.value };
};

export const validChallengeTarget = (baseTarget, challengeTarget) => {
  const challenge = normalizeNumericInput(challengeTarget);
  if (challenge.status === KPI_VALUE_STATUS.FIELD_MISSING || challenge.status === KPI_VALUE_STATUS.VALID_ZERO) {
    return { status: KPI_VALUE_STATUS.CHALLENGE_NOT_SET, valid: false, configured: false, value: null };
  }
  if (challenge.status === KPI_VALUE_STATUS.DATA_INVALID || challenge.value < 0) {
    return { status: KPI_VALUE_STATUS.DATA_INVALID, valid: false, configured: true, value: null };
  }

  const base = validBaseTarget(baseTarget);
  if (!base.valid || !(challenge.value > base.value)) {
    return { status: KPI_VALUE_STATUS.DATA_INVALID, valid: false, configured: true, value: null };
  }

  return { status: KPI_VALUE_STATUS.VALID, valid: true, configured: true, value: challenge.value };
};

export const validRatio = (numerator, denominator, options = {}) => {
  const numeratorResult = normalizeNumericInput(numerator);
  const denominatorResult = normalizeNumericInput(denominator);
  const inputs = [numeratorResult, denominatorResult];

  if (!inputs.every(isNumericValid)) {
    return { status: propagateNumericFailure(inputs), valid: false, value: null };
  }

  const requirePositiveDenominator = options.requirePositiveDenominator === true;
  if (denominatorResult.value === 0 || (requirePositiveDenominator && denominatorResult.value <= 0)) {
    return { status: KPI_VALUE_STATUS.N_A, valid: false, value: null };
  }

  const value = numeratorResult.value / denominatorResult.value;
  if (!Number.isFinite(value)) {
    return { status: KPI_VALUE_STATUS.DATA_INVALID, valid: false, value: null };
  }
  return {
    status: value === 0 ? KPI_VALUE_STATUS.VALID_ZERO : KPI_VALUE_STATUS.VALID,
    valid: true,
    value,
  };
};

export const validateStoreHealthBenchmark = (min, max) => {
  const minResult = normalizeNumericInput(min);
  const maxResult = normalizeNumericInput(max);
  const inputs = [minResult, maxResult];

  if (!inputs.every(isNumericValid)) {
    return {
      status: propagateNumericFailure(inputs),
      valid: false,
      min: null,
      max: null,
    };
  }

  if (!(minResult.value > 0) || !(maxResult.value > minResult.value)) {
    return {
      status: KPI_VALUE_STATUS.DATA_INVALID,
      valid: false,
      min: minResult.value,
      max: maxResult.value,
    };
  }

  return {
    status: KPI_VALUE_STATUS.VALID,
    valid: true,
    min: minResult.value,
    max: maxResult.value,
  };
};
