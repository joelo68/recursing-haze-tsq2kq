// src/components/SmartMonthPicker.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DESKTOP_PANEL_WIDTH = 360;
const PANEL_MARGIN = 12;
const PANEL_GAP = 8;
const PANEL_ESTIMATED_HEIGHT = 340;

const normalizeMonth = (value = "") => {
  const text = String(value || "").trim();
  return MONTH_PATTERN.test(text) ? text : "";
};

const parseMonth = (value = "") => {
  const normalized = normalizeMonth(value);
  if (!normalized) return null;
  const [year, month] = normalized.split("-").map(Number);
  return { year, month, key: normalized };
};

const buildMonthKey = (year, month) =>
  `${Number(year)}-${String(Number(month)).padStart(2, "0")}`;

const SmartMonthPicker = ({
  value,
  onChange,
  minMonth = "",
  maxMonth = "",
  align = "right",
  className = "",
  buttonClassName = "",
  showCurrentMonth = true,
  disabled = false,
  allowClear = false,
  placeholder = "選擇月份",
}) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const fallbackKey = buildMonthKey(currentYear, currentMonth);

  const selected = parseMonth(value);
  const fallback = parseMonth(fallbackKey);
  const min = parseMonth(minMonth);
  const max = parseMonth(maxMonth);

  const [isOpen, setIsOpen] = useState(false);
  const [displayYear, setDisplayYear] = useState(selected?.year || fallback.year);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  const [panelCoords, setPanelCoords] = useState({
    top: PANEL_MARGIN,
    left: PANEL_MARGIN,
    width: DESKTOP_PANEL_WIDTH,
  });

  const containerRef = useRef(null);
  const panelRef = useRef(null);

  const isAllowed = (year, month) => {
    const key = buildMonthKey(year, month);
    if (min && key < min.key) return false;
    if (max && key > max.key) return false;
    return true;
  };

  const currentAllowed = useMemo(
    () => isAllowed(currentYear, currentMonth),
    [currentYear, currentMonth, min?.key, max?.key]
  );

  const minYear = min?.year ?? null;
  const maxYear = max?.year ?? null;
  const canGoPreviousYear = minYear === null || displayYear > minYear;
  const canGoNextYear = maxYear === null || displayYear < maxYear;

  const measurePanelPosition = useCallback(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    const mobile = window.innerWidth < 768;
    setIsMobile(mobile);
    if (mobile) return;

    const triggerRect = containerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      DESKTOP_PANEL_WIDTH,
      Math.max(240, viewportWidth - PANEL_MARGIN * 2)
    );

    const measuredHeight =
      panelRef.current?.getBoundingClientRect().height || PANEL_ESTIMATED_HEIGHT;

    let left =
      align === "left"
        ? triggerRect.left
        : triggerRect.right - width;

    left = Math.max(
      PANEL_MARGIN,
      Math.min(left, viewportWidth - width - PANEL_MARGIN)
    );

    const enoughBelow =
      viewportHeight - triggerRect.bottom >= measuredHeight + PANEL_GAP;
    const enoughAbove =
      triggerRect.top >= measuredHeight + PANEL_GAP;

    let top =
      !enoughBelow && enoughAbove
        ? triggerRect.top - measuredHeight - PANEL_GAP
        : triggerRect.bottom + PANEL_GAP;

    top = Math.max(
      PANEL_MARGIN,
      Math.min(top, viewportHeight - measuredHeight - PANEL_MARGIN)
    );

    setPanelCoords({ top, left, width });
  }, [align]);

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
      return undefined;
    }
    if (!isOpen) return undefined;

    setDisplayYear(selected?.year || fallback.year);

    const handleOutside = (event) => {
      if (containerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [disabled, isOpen, selected?.year, fallback.year]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return undefined;

    const updatePosition = () => measurePanelPosition();
    const frame = window.requestAnimationFrame(updatePosition);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, measurePanelPosition, displayYear, allowClear, selected?.key]);

  const togglePicker = () => {
    if (disabled) return;
    if (!isOpen) measurePanelPosition();
    setIsOpen((open) => !open);
  };

  const selectMonth = (month) => {
    if (!isAllowed(displayYear, month)) return;
    onChange?.(buildMonthKey(displayYear, month));
    setIsOpen(false);
  };

  const selectCurrentMonth = () => {
    if (!currentAllowed) return;
    onChange?.(buildMonthKey(currentYear, currentMonth));
    setIsOpen(false);
  };

  const clearMonth = () => {
    if (!allowClear || disabled) return;
    onChange?.("");
    setIsOpen(false);
  };

  const panelContent = (
    <div
      ref={panelRef}
      className={
        isMobile
          ? "fixed left-1/2 top-1/2 z-[9999] w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-stone-100 bg-white p-4 shadow-2xl"
          : "fixed z-[9999] rounded-2xl border border-stone-100 bg-white p-4 shadow-2xl"
      }
      style={
        isMobile
          ? undefined
          : {
              top: `${panelCoords.top}px`,
              left: `${panelCoords.left}px`,
              width: `${panelCoords.width}px`,
            }
      }
    >
      <div className="flex items-center justify-between gap-3 px-1 pb-3">
        <button
          type="button"
          onClick={() => canGoPreviousYear && setDisplayYear((year) => year - 1)}
          disabled={!canGoPreviousYear}
          className="rounded-xl p-2 text-stone-500 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-25"
          aria-label="上一年"
        >
          <ChevronLeft size={20} />
        </button>

        <div className="text-base font-extrabold text-stone-800">{displayYear}年</div>

        <button
          type="button"
          onClick={() => canGoNextYear && setDisplayYear((year) => year + 1)}
          disabled={!canGoNextYear}
          className="rounded-xl p-2 text-stone-500 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-25"
          aria-label="下一年"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
          const allowed = isAllowed(displayYear, month);
          const isSelected =
            Boolean(selected) &&
            displayYear === selected.year &&
            month === selected.month;
          const isCurrent =
            displayYear === currentYear && month === currentMonth;

          return (
            <button
              key={month}
              type="button"
              onClick={() => selectMonth(month)}
              disabled={!allowed}
              className={`rounded-xl px-2 py-3 text-sm font-extrabold transition-all ${
                isSelected
                  ? "bg-amber-500 text-white shadow-sm shadow-amber-100"
                  : isCurrent
                    ? "border border-amber-200 bg-amber-50 text-amber-700"
                    : "border border-transparent bg-stone-50 text-stone-600 hover:border-stone-200 hover:bg-white"
              } disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-200`}
            >
              {month}月
            </button>
          );
        })}
      </div>

      {(allowClear || (showCurrentMonth && currentAllowed)) && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 pt-3">
          <div>
            {allowClear && selected && (
              <button
                type="button"
                onClick={clearMonth}
                className="rounded-xl px-3 py-2 text-xs font-extrabold text-stone-500 hover:bg-stone-50"
              >
                清除
              </button>
            )}
          </div>
          {showCurrentMonth && currentAllowed && (
            <button
              type="button"
              onClick={selectCurrentMonth}
              className="rounded-xl px-3 py-2 text-xs font-extrabold text-amber-700 hover:bg-amber-50"
            >
              回到本月
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className={`relative w-full md:w-auto ${className}`.trim()}>
      <button
        type="button"
        onClick={togglePicker}
        disabled={disabled}
        className={`inline-flex w-full min-w-[154px] items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-extrabold text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-300 disabled:shadow-none md:w-auto ${buttonClassName}`.trim()}
      >
        <span>
          {selected
            ? `${selected.year}年 ${String(selected.month).padStart(2, "0")}月`
            : placeholder}
        </span>
        <CalendarDays size={17} className="shrink-0 text-stone-500" />
      </button>

      {isOpen &&
        typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <>
            {isMobile && (
              <button
                type="button"
                aria-label="關閉月份選擇"
                onClick={() => setIsOpen(false)}
                className="fixed inset-0 z-[9998] bg-stone-900/20 backdrop-blur-[1px]"
              />
            )}
            {panelContent}
          </>,
          document.body
        )}
    </div>
  );
};

export default SmartMonthPicker;
