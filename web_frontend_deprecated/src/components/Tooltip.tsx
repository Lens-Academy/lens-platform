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

  const hover = useHover(context, {
    delay: { open: delay, close: 0 },
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

  /* eslint-disable react-hooks/refs -- floating-ui's setReference/setFloating are callback refs (functions), not ref.current access */
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
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="bg-gray-800 text-white text-xs px-2 py-1 rounded z-50">
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
