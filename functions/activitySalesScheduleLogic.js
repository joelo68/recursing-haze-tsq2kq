"use strict";

const MAX_TASK_DELAY_MS = 25 * 24 * 60 * 60 * 1000;
const BRAND_IDS = new Set(["cyj", "anniu", "yibo"]);
const CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function validateScheduleIdentity(raw = {}) {
  const brandId = String(raw.brandId || "");
  const campaignId = String(raw.campaignId || "");
  const versionId = String(raw.versionId || "");
  if (!BRAND_IDS.has(brandId) || !CAMPAIGN_ID.test(campaignId) ||
      !CAMPAIGN_ID.test(versionId) || !versionId.startsWith(`${campaignId}_v`)) {
    throw new Error("ACTIVITY_SCHEDULE_IDENTITY_INVALID");
  }
  return { brandId, campaignId, versionId };
}

function scheduledTimeMs(campaign = {}) {
  const text = String(campaign.scheduledPublishAtText || "");
  // Stored time must be canonical UTC, not an ambiguous local timestamp.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) return NaN;
  return Date.parse(text);
}

function isScheduledCandidate(campaign = {}, ids = {}) {
  return campaign.status === "approved" &&
    campaign.releaseMode === "scheduled_after_approval" &&
    campaign.brandId === ids.brandId &&
    campaign.campaignId === ids.campaignId &&
    campaign.currentVersionId === ids.versionId;
}

function chooseScheduledTaskTime(targetMs, nowMs = Date.now()) {
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) {
    throw new Error("ACTIVITY_SCHEDULE_TIME_INVALID");
  }
  return new Date(Math.max(nowMs, Math.min(targetMs, nowMs + MAX_TASK_DELAY_MS)));
}

function taipeiCalendarDate(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function scheduleDecision(campaign, identity, nowMs = Date.now()) {
  if (!isScheduledCandidate(campaign, identity)) return { state: "skip" };
  const targetMs = scheduledTimeMs(campaign);
  if (!Number.isFinite(targetMs)) return { state: "invalid" };
  if (nowMs < targetMs) {
    return { state: "requeue", scheduleTime: chooseScheduledTaskTime(targetMs, nowMs) };
  }
  return { state: "publish" };
}

function scheduleTransition(before, after, identity) {
  return isScheduledCandidate(after, identity) &&
    !isScheduledCandidate(before || {}, identity);
}

module.exports = {
  MAX_TASK_DELAY_MS, validateScheduleIdentity, scheduledTimeMs,
  isScheduledCandidate, chooseScheduledTaskTime, scheduleDecision,
  scheduleTransition, taipeiCalendarDate,
};
