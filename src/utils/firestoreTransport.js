// src/utils/firestoreTransport.js

export const shouldForceFirestoreLongPolling = ({
  userAgent = "",
  maxTouchPoints = 0,
} = {}) => {
  const ua = String(userAgent || "");
  const touchPoints = Number.isFinite(Number(maxTouchPoints))
    ? Number(maxTouchPoints)
    : 0;

  const isClassicIOS = /iPhone|iPad|iPod/i.test(ua);
  const isIPadOSDesktopMode = /Macintosh/i.test(ua) && touchPoints > 1;
  const isAppleWebKit = /AppleWebKit/i.test(ua);

  return isAppleWebKit && (isClassicIOS || isIPadOSDesktopMode);
};

export const shouldForceFirestoreLongPollingForCurrentBrowser = () => {
  if (typeof navigator === "undefined") return false;

  return shouldForceFirestoreLongPolling({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });
};
