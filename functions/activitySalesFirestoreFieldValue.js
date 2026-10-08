"use strict";

// Firebase Admin v11+ may not expose FieldValue on the deprecated admin.firestore namespace.
// Existing isolated unit tests inject a legacy-compatible fake; the real backend uses
// the modular Firestore SDK when that fake is absent.
function activitySalesServerTimestamp(admin) {
  const injectedFieldValue = admin?.firestore?.FieldValue;
  if (typeof injectedFieldValue?.serverTimestamp === "function") {
    return injectedFieldValue.serverTimestamp();
  }
  const { FieldValue } = require("firebase-admin/firestore");
  if (typeof FieldValue?.serverTimestamp !== "function") {
    throw new Error("ACTIVITY_SALES_FIRESTORE_TIMESTAMP_UNAVAILABLE");
  }
  return FieldValue.serverTimestamp();
}

module.exports = { activitySalesServerTimestamp };
