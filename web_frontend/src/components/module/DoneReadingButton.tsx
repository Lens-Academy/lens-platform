/**
 * DoneReadingButton — circular checkmark button with "Done reading?" / "Done reading!" label.
 *
 * Fully controlled: `isChecked` / `onChange` props.
 * - Unchecked: white bg, gray-300 border, gray checkmark, gray label
 * - Checked: emerald-500 bg, white checkmark, emerald label
 * - Toggling: clicking checked → unchecked (and vice versa)
 * - Auto-trigger (one-shot): IntersectionObserver on sentinel fires onChange(true)
 * - Hidden native <input type="checkbox"> for accessibility
 */

import { useState, useRef, useEffect } from "react";

type DoneReadingButtonProps = {
  isChecked: boolean;
  onChange: (checked: boolean) => void;
};

export function DoneReadingButton({
  isChecked,
  onChange,
}: DoneReadingButtonProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const hasFiredRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Animate when isChecked transitions to true
  useEffect(() => {
    if (isChecked) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isChecked]);

  // Keep hasFiredRef in sync so IntersectionObserver won't re-fire after external check
  useEffect(() => {
    if (isChecked) hasFiredRef.current = true;
  }, [isChecked]);

  // Auto-trigger (one-shot) when sentinel scrolls fully into view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !hasFiredRef.current) {
          hasFiredRef.current = true;
          onChange(true);
        }
      },
      { threshold: 1.0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onChange]);

  const handleChange = () => {
    const next = !isChecked;
    if (next) hasFiredRef.current = true;
    onChange(next);
  };

  return (
    <div className="px-4">
      <div className="max-w-content mx-auto flex justify-end py-2">
        <label className="flex items-center gap-2 cursor-pointer select-none group">
          <span
            className={`text-sm transition-colors duration-300 ${
              isChecked
                ? "text-emerald-600"
                : "text-gray-400 group-hover:text-gray-500"
            }`}
          >
            {isChecked ? "Done reading!" : "Done reading?"}
          </span>

          {/* Hidden native checkbox for accessibility */}
          <input
            type="checkbox"
            checked={isChecked}
            onChange={handleChange}
            className="sr-only"
            aria-label="Mark as done reading"
          />

          {/* Visual checkmark circle */}
          <div
            className={`
              w-8 h-8 rounded-full flex items-center justify-center
              border-2 transition-all duration-300
              ${
                isChecked
                  ? `bg-emerald-500 border-emerald-500 ${isAnimating ? "scale-110" : "scale-100"}`
                  : "bg-white border-gray-300 group-hover:border-gray-400"
              }
            `}
          >
            <svg
              className={`w-4 h-4 transition-colors duration-300 ${isChecked ? "text-white" : "text-gray-400"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </label>
      </div>

      {/* Sentinel for IntersectionObserver auto-trigger */}
      <div ref={sentinelRef} className="w-full h-px" aria-hidden="true" />
    </div>
  );
}
