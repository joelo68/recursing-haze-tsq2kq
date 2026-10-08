"use strict";

// Activity Sales backend actor/claim equality gate; pure to allow isolated tests.
function assertActivitySalesSessionActor(authResult = {}, brand = "", rawActor = {}) {
  const claim = authResult.decoded || {};
  if (!authResult.ok || claim.drcyjIdentity !== true ||
      claim.identityVersion !== "application-identity-v1" ||
      claim.brandId !== brand || claim.roleId !== String(rawActor.roleId || "").trim() ||
      String(claim.accountId || "") !== String(rawActor.accountId || "").trim()) {
    const error = new Error("活動操作的登入品牌或帳號不一致，請重新登入");
    error.code = "ACTIVITY_SESSION_MISMATCH";
    error.status = 403;
    throw error;
  }
  return true;
}
module.exports = { assertActivitySalesSessionActor };
