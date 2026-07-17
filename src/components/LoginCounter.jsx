import React, { useEffect, useRef, useState } from "react";

const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);

const LoginCounter = ({
  totalUsers = 0,
  brandName = "",
  status = "loading",
  error = "",
  onRetry,
}) => {
  const [displayCount, setDisplayCount] = useState(0);
  const displayCountRef = useRef(0);
  const frameRef = useRef(null);

  const isReady = status === "ready" || status === "refreshing";
  const isRefreshing = status === "refreshing";
  const isFailed = status === "error";

  useEffect(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (!isReady) {
      displayCountRef.current = 0;
      setDisplayCount(0);
      return undefined;
    }

    const target = Math.max(0, Number(totalUsers || 0));
    const start = displayCountRef.current;
    const distance = target - start;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (reduceMotion || distance === 0) {
      displayCountRef.current = target;
      setDisplayCount(target);
      return undefined;
    }

    const duration = 880;
    let startedAt = null;

    const animate = (timestamp) => {
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const nextValue = Math.round(start + distance * easeOutCubic(progress));

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
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [totalUsers, isReady]);

  const shellClass =
    "inline-flex min-h-[36px] items-center gap-2.5 rounded-full border border-stone-200/60 bg-stone-200/50 px-4 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-500 hover:bg-stone-200/80";

  return (
    <div className="mt-4 flex items-center justify-center animate-in fade-in duration-700">
      <div className={shellClass} title={error || undefined}>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isFailed
              ? "bg-rose-400"
              : isReady
                ? "bg-stone-400 animate-pulse"
                : "bg-stone-300 animate-pulse"
          }`}
        />

        <span className="flex min-w-0 items-center text-[11px] font-medium uppercase tracking-widest text-stone-500">
          {brandName && (
            <span className="mr-1.5 whitespace-nowrap font-bold text-stone-600">
              {brandName}
            </span>
          )}

          {!isReady && !isFailed && (
            <>
              <span className="whitespace-nowrap">正在同步授權名單</span>
              <span className="ml-1.5 inline-flex items-end gap-0.5" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="h-1 w-1 rounded-full bg-stone-400 animate-bounce"
                    style={{ animationDelay: `${index * 140}ms` }}
                  />
                ))}
              </span>
            </>
          )}

          {isFailed && (
            <>
              <span className="whitespace-nowrap text-rose-500">名單同步未完成</span>
              {typeof onRetry === "function" && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="ml-2 whitespace-nowrap rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black normal-case tracking-normal text-stone-600 transition-colors hover:bg-white"
                >
                  重新載入
                </button>
              )}
            </>
          )}

          {isReady && (
            <>
              <span className="whitespace-nowrap">授權使用</span>
              <span className="mx-2 min-w-[1.5ch] text-center font-sans text-[14px] font-bold tracking-tight text-stone-700 tabular-nums">
                {displayCount}
              </span>
              <span className="whitespace-nowrap">位夥伴</span>

              {isRefreshing && (
                <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap text-[9px] font-bold normal-case tracking-normal text-stone-400">
                  <span className="h-1 w-1 rounded-full bg-stone-400 animate-ping" />
                  同步中
                </span>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
};

export default LoginCounter;
