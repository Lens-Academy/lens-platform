import {
  useState,
  useRef,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useHover,
  useInteractions,
  safePolygon,
  offset,
  flip,
  shift,
  type Placement,
  FloatingPortal,
} from "@floating-ui/react";

type PopoverProps = {
  content: ReactNode | ((close: () => void) => ReactNode);
  children: ReactElement;
  placement?: Placement;
  /** Override the default panel className */
  className?: string;
  /** Additional inline styles for the panel (merged with positioning styles) */
  panelStyle?: React.CSSProperties;
  /** Enable hover to preview + click to pin open */
  hover?: boolean;
};

export function Popover({
  content,
  children,
  placement = "top",
  className = "bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50 max-w-xs",
  panelStyle,
  hover: enableHover = false,
}: PopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Track whether user clicked to "pin" the popover open
  const pinned = useRef(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange(open, _event, reason) {
      if (
        !open &&
        pinned.current &&
        reason !== "escape-key" &&
        reason !== "outside-press"
      ) {
        // Hover trying to close, but user clicked to pin — stay open
        return;
      }
      if (!open) {
        pinned.current = false;
      }
      setIsOpen(open);
    },
    placement,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  const click = useClick(context, {
    toggle: true,
    event: "click",
  });
  const dismiss = useDismiss(context);
  const hoverInteraction = useHover(context, {
    enabled: enableHover,
    delay: { open: 0, close: 150 },
    handleClose: safePolygon(),
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    ...(enableHover ? [hoverInteraction] : []),
    click,
    dismiss,
  ]);

  const close = () => {
    pinned.current = false;
    setIsOpen(false);
  };

  // When hover is enabled, pin on click
  const handleClick = enableHover
    ? () => {
        pinned.current = !pinned.current;
      }
    : undefined;

  if (!isValidElement(children)) {
    return children;
  }

  const refProps = getReferenceProps() as Record<string, unknown>;
  const childProps = children.props as Record<string, unknown>;
  const childWithRef = cloneElement(children, {
    ref: refs.setReference,
    ...refProps,
    ...(handleClick
      ? {
          onClick: (e: React.MouseEvent) => {
            handleClick();
            if (typeof refProps.onClick === "function") refProps.onClick(e);
            if (typeof childProps.onClick === "function") childProps.onClick(e);
          },
        }
      : {}),
  } as React.HTMLAttributes<HTMLElement> & {
    ref: typeof refs.setReference;
  });

  return (
    <>
      {childWithRef}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...panelStyle }}
            {...getFloatingProps()}
            className={className}
          >
            {typeof content === "function" ? content(close) : content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
