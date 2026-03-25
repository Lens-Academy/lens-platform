import { Check } from "lucide-react";
import { StageIcon } from "./StageIcon";
import { getCircleFillClasses, getRingClasses } from "../utils/stageProgress";

type StageCircleProps = {
  type: string;
  displayType?: string;
  isCompleted: boolean;
  isViewing?: boolean;
  isOptional?: boolean;
  size?: 24 | 28 | 32 | 44;
  optionalBg?: string;
  includeHover?: boolean;
  showCheckBadge?: boolean;
  className?: string;
};

export function StageCircle({
  type,
  displayType,
  isCompleted,
  isViewing = false,
  isOptional = false,
  size = 28,
  optionalBg = "bg-white",
  includeHover = false,
  showCheckBadge = true,
  className,
}: StageCircleProps) {
  const fillClasses = getCircleFillClasses(
    { isCompleted, isViewing, isOptional },
    { includeHover, optionalBg },
  );
  const ringClasses = getRingClasses(isViewing, isCompleted);

  const sizeClass = {
    24: "w-6 h-6",
    28: "w-7 h-7",
    32: "w-8 h-8",
    44: "min-w-[44px] min-h-[44px] w-11 h-11",
  }[size];

  // Icon sizing for small circles — video/chat icons are naturally larger
  const isLargeIcon = type === "video" || type === "chat" ||
    (type === "lens" && (displayType === "lens-video" || displayType === "lens-mixed"));
  const iconOverride = size === 24
    ? (isLargeIcon ? "[&_svg]:w-[18px] [&_svg]:h-[18px]" : "[&_svg]:w-3.5 [&_svg]:h-3.5")
    : "";

  const badgeSize = size <= 24 ? "h-3 w-3" : "h-3.5 w-3.5";
  const badgeIcon = size <= 24 ? "w-2 h-2" : "w-2.5 h-2.5";

  return (
    <div className={`relative flex-shrink-0 ${className ?? ""}`}>
      <div
        className={`rounded-full flex items-center justify-center ${sizeClass} ${fillClasses} ${ringClasses} ${iconOverride}`}
      >
        <StageIcon type={type} displayType={displayType} small={size <= 32} />
      </div>
      {showCheckBadge && isCompleted && (
        <div className={`absolute -bottom-0.5 -right-0.5 flex ${badgeSize} items-center justify-center rounded-full bg-lens-orange-400 ring-[1.5px] ring-white`}>
          <Check className={badgeIcon} stroke="white" strokeWidth={3} />
        </div>
      )}
    </div>
  );
}
