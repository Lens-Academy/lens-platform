import {
  useState,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
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
};

export function Popover({
  content,
  children,
  placement = "top",
}: PopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

  const close = () => setIsOpen(false);

  if (!isValidElement(children)) {
    return children;
  }

  /* eslint-disable react-hooks/refs -- floating-ui's setReference/setFloating are callback refs (functions), not ref.current access */
  const childWithRef = cloneElement(children, {
    ref: refs.setReference,
    ...getReferenceProps(),
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
            className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50 max-w-xs"
          >
            {typeof content === "function" ? content(close) : content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
