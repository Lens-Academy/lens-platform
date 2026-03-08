import {
  useState,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  useFloating,
  useHover,
  useFocus,
  useDismiss,
  useInteractions,
  useDelayGroup,
  offset,
  flip,
  shift,
  type Placement,
  FloatingPortal,
} from "@floating-ui/react";

type TooltipProps = {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  delay?: number;
  persistOnClick?: boolean;
};

export function Tooltip({
  content,
  children,
  placement = "top",
  delay = 400,
  persistOnClick = false,
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  const { delay: groupDelay } = useDelayGroup(context);

  const hover = useHover(context, {
    delay: groupDelay ?? { open: delay, close: 0 },
  });

  const focus = useFocus(context);

  const dismiss = useDismiss(context, {
    // Don't close on click if persistOnClick is true
    referencePress: !persistOnClick,
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);

  // Handle click to show tooltip immediately when persistOnClick is true
  const handleClick = persistOnClick
    ? () => {
        if (!isOpen) setIsOpen(true);
      }
    : undefined;

  if (!isValidElement(children)) {
    return children;
  }

  const childWithRef = cloneElement(children, {
    ref: refs.setReference,
    ...getReferenceProps({
      onClick: (e: React.MouseEvent) => {
        // Call original onClick if it exists
        const childProps = children.props as {
          onClick?: (e: React.MouseEvent) => void;
        };
        childProps.onClick?.(e);
        // Then handle tooltip click behavior
        handleClick?.();
      },
    }),
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
            style={floatingStyles}
            {...getFloatingProps()}
            className="bg-white text-slate-700 text-sm px-3.5 py-2.5 rounded-lg shadow-lg ring-1 ring-slate-200/60 max-w-xs z-50"
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
