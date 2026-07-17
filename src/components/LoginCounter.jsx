import React, { useEffect, useRef, useState } from "react";

const clampCount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
};

const LoginCounter = ({
  totalUsers = 0,
  brandName = "",
  status = "ready", // loading | complete | ready | refreshing | error
  animationKey = "",
  onRetry = null,
}) => {
  const [displayCount, setDisplayCount] = useState(0);
  const displayCountRef = useRef(0);
  const frameRef = useRef(null);

  useEffect(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    displayCountRef.current = 0;
    setDisplayCount(0);
  }, [animationKey]);

  useEffect(() => {
    const canAnimateCount = ["complete", "ready", "refreshing"].includes(status);
    if (!canAnimateCount) return undefined;

    const target = clampCount(totalUsers);
    const startValue = clampCount(displayCountRef.current);

    if (frameRef.current) cancelAnimationFrame(frameRef.current);

    const reduceMotion = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (reduceMotion || target === startValue) {
      displayCountRef.current = target;
      setDisplayCount(target);
      return undefined;
    }

    const duration = startValue === 0 ? 1050 : 680;
    const startedAt = performance.now();

    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + ((target - startValue) * eased));

      displayCountRef.current = nextValue;
      setDisplayCount(nextValue);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        displayCountRef.current = target;
        setDisplayCount(target);
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [totalUsers, status, animationKey]);

  const shellClass = "inline-flex min-h-[34px] min-w-[220px] items-center justify-center gap-2.5 rounded-full border border-stone-200/70 bg-stone-200/50 px-4 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] backdrop-blur-sm transition-all duration-700";

  if (status === "loading") {
    return (
      <div className="mt-4 flex items-center justify-center animate-in fade-in duration-800" aria-live="polite">
        <div className={`${shellClass} text-stone-500`}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stone-400 opacity-30" style={{ animationDuration: "1400ms" }} />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-stone-400" />
          </span>
          <span className="text-[11px] font-bold tracking-widest">
            {brandName && <span className="mr-1.5 text-stone-600">{brandName}</span>}
            正在同步授權名單
          </span>
          <span className="flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-1 w-1 rounded-full bg-stone-400 animate-bounce"
                style={{ animationDelay: `${index * 160}ms`, animationDuration: "1200ms" }}
              />
            ))}
          </span>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mt-4 flex items-center justify-center animate-in fade-in duration-300" aria-live="polite">
        <button
          type="button"
          onClick={() => onRetry?.()}
          className={`${shellClass} border-rose-100 bg-rose-50/70 text-[11px] font-bold tracking-widest text-rose-600 hover:bg-rose-100`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          名單同步未完成・重新載入
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-center justify-center animate-in fade-in duration-800" aria-live="polite">
      <div className={`${shellClass} ${status === "complete" ? "border-emerald-100 bg-emerald-50/60" : "hover:bg-stone-200/80"}`}>
        {status === "complete" ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-white animate-in zoom-in duration-500">✓</span>
        ) : status === "refreshing" ? (
          <span className="h-3 w-3 animate-spin rounded-full border border-stone-300 border-t-stone-500" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-pulse" />
        )}

        <span className="flex items-center text-[11px] font-medium tracking-widest text-stone-500">
          {brandName && <span className="mr-1.5 font-bold text-stone-600">{brandName}</span>}
          授權使用
          <span className="mx-2 min-w-[2.2ch] text-center font-sans text-[14px] font-bold tabular-nums tracking-tight text-stone-700">
            {displayCount}
          </span>
          位夥伴
        </span>

        {status === "refreshing" && (
          <span className="text-[10px] font-bold tracking-normal text-stone-400">同步中</span>
        )}
      </div>
    </div>
  );
};

export default LoginCounter;
