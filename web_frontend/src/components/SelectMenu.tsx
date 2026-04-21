import { useState, useRef, useCallback, useEffect } from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
  size,
  FloatingPortal,
} from "@floating-ui/react";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption<T extends string | number = string | number> {
  value: T;
  label: string;
  description?: string;
}

interface SelectMenuProps<T extends string | number = string | number> {
  value: T | null;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  id?: string;
}

export function SelectMenu<T extends string | number = string | number>({
  value,
  onChange,
  options,
  placeholder = "Select...",
  id,
}: SelectMenuProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<(HTMLDivElement | null)[]>([]);

  const selected = options.find((o) => o.value === value);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom-start",
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

  // Reset active index when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, options, value]);

  // Scroll active item into view
  useEffect(() => {
    if (isOpen && activeIndex >= 0 && listRef.current[activeIndex]) {
      listRef.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, activeIndex]);

  const handleSelect = useCallback(
    (option: SelectOption<T>) => {
      onChange(option.value);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, options.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < options.length) {
            handleSelect(options[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [isOpen, activeIndex, options, handleSelect],
  );

  return (
    <div>
      {/* Trigger button */}
      <button
        type="button"
        id={id}
        ref={refs.setReference}
        {...getReferenceProps()}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between px-3 py-2 border rounded-lg text-left transition-colors outline-none ${
          isOpen
            ? "border-[var(--brand-accent)] ring-2 ring-[var(--brand-accent)]"
            : "border-gray-300 hover:border-gray-400"
        } ${selected ? "text-gray-900" : "text-gray-400"}`}
      >
        <span className="truncate">
          {selected
            ? selected.description
              ? `${selected.label} — ${selected.description}`
              : selected.label
            : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 ml-2 shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Floating panel */}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            role="listbox"
            className="bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-auto max-h-64"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <div
                  key={option.value}
                  ref={(el) => {
                    listRef.current[index] = el;
                  }}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                    isActive ? "bg-gray-50" : ""
                  } ${isSelected ? "bg-orange-50" : ""}`}
                >
                  {/* Check icon */}
                  <div className="w-4 h-4 mt-0.5 shrink-0">
                    {isSelected && (
                      <Check className="w-4 h-4 text-[var(--brand-accent)]" />
                    )}
                  </div>
                  {/* Label + description */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                      {option.label}
                    </div>
                    {option.description && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {option.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
