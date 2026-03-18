import { StageIcon } from "./StageProgressBar";
import { formatDurationMinutes } from "../../utils/duration";

export interface SectionChoice {
  index: number;
  type: "lens-video" | "lens-article" | "page" | "test";
  title: string;
  tldr?: string;
  optional: boolean;
  completed?: boolean;
  duration?: number | null;
}

interface Props {
  isOpen: boolean;
  // What was just completed
  completedTitle?: string;
  isModuleComplete?: boolean;
  isSubmodule?: boolean;
  moduleTitle?: string;
  parentTitle?: string;
  // Options to show
  choices?: SectionChoice[];
  onChoose?: (sectionIndex: number) => void;
  // Next module / course navigation
  nextModuleLink?: { label: string; href: string } | null;
  enrollLink?: { label: string; href: string } | null;
  courseLink?: { label: string; href: string } | null;
  // Shared
  onDismiss: () => void;
}

function SectionTypeLabel({
  type,
  duration,
}: {
  type: SectionChoice["type"];
  duration?: number | null;
}) {
  const label =
    type === "lens-video"
      ? "Video"
      : type === "lens-article"
        ? "Article"
        : type === "test"
          ? "Test"
          : "Page";
  return (
    <>
      {label}
      {duration != null &&
        duration > 0 &&
        ` · ${formatDurationMinutes(duration)}`}
    </>
  );
}

// ---------------------------------------------------------------------------
// Section choice card
// ---------------------------------------------------------------------------

function CompletedBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
      Already completed
    </span>
  );
}

function SectionChoiceButton({
  choice,
  onChoose,
  variant,
}: {
  choice: SectionChoice;
  onChoose: (index: number) => void;
  variant: "optional" | "required";
}) {
  if (variant === "optional") {
    // Completed optional: orange-gold dashed border + gold icon (matches progress bar)
    const iconClasses = choice.completed
      ? "w-6 h-6 rounded-full border-2 border-dashed border-[#d08838] bg-[var(--brand-bg)] flex items-center justify-center flex-shrink-0 mt-0.5 text-[#d08838]"
      : "w-6 h-6 rounded-full border-2 border-dashed border-gray-400 bg-white flex items-center justify-center flex-shrink-0 mt-0.5 text-gray-400";

    return (
      <button
        onClick={() => onChoose(choice.index)}
        className="w-full flex items-start gap-3 p-3 rounded-[10px] border-[1.5px] border-gray-200 bg-white hover:border-[#dea96c] hover:bg-[#fdf8f0] transition-colors text-left"
      >
        <div className={iconClasses}>
          <StageIcon type={choice.type} small />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-[#7a470c]">
              {choice.title}
            </span>
            <span className="text-[10px] font-medium bg-[#f9eedb] text-[#9a5c10] px-1.5 py-0.5 rounded">
              Optional
            </span>
          </div>
          <div className="text-xs text-[#b87018] mt-0.5">
            <SectionTypeLabel type={choice.type} duration={choice.duration} />
          </div>
          {choice.completed && <CompletedBadge />}
          {choice.tldr && (
            <p className="text-xs text-gray-700 mt-1 leading-relaxed">
              {choice.tldr}
            </p>
          )}
        </div>
      </button>
    );
  }

  // Completed required: orange bg + white icon (matches progress bar)
  const iconClasses = choice.completed
    ? "w-7 h-7 rounded-full bg-[#d08838] flex items-center justify-center flex-shrink-0 mt-0.5 text-white"
    : "w-7 h-7 rounded-full border-2 border-gray-400 flex items-center justify-center flex-shrink-0 mt-0.5 text-gray-400";

  return (
    <button
      onClick={() => onChoose(choice.index)}
      className="w-full flex items-start gap-3 p-3.5 rounded-[10px] border-[1.5px] border-[#dea96c] bg-[#fdf8f0]/60 hover:border-[#d08838] hover:bg-[#fdf8f0] transition-colors text-left"
    >
      <div className={iconClasses}>
        <StageIcon type={choice.type} small />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-[#7a470c]">
          {choice.title}
        </div>
        <div className="text-xs text-[#9a5c10] mt-0.5">
          <SectionTypeLabel type={choice.type} duration={choice.duration} />
        </div>
        {choice.completed && <CompletedBadge />}
        {choice.tldr && (
          <p className="text-xs text-gray-700 mt-1 leading-relaxed">
            {choice.tldr}
          </p>
        )}
      </div>
      <svg
        className="w-[18px] h-[18px] text-[#d08838] flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Checkmark icon (reused)
// ---------------------------------------------------------------------------

function CheckCircle() {
  return (
    <svg
      className="w-5 h-5 text-green-500 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main modal component — single unified layout
// ---------------------------------------------------------------------------

export default function SectionChoiceModal({
  isOpen,
  completedTitle,
  isModuleComplete,
  isSubmodule,
  moduleTitle,
  parentTitle,
  choices = [],
  onChoose,
  nextModuleLink,
  enrollLink,
  courseLink,
  onDismiss,
}: Props) {
  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onDismiss();
  };

  const handleChoose = (index: number) => {
    onChoose?.(index);
  };

  const optionalChoices = choices.filter((c) => c.optional);
  const requiredChoices = choices.filter((c) => !c.optional);

  const optionalLabel =
    optionalChoices.length === 1
      ? "Want to explore this optional lens?"
      : "Want to explore an optional lens?";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[calc(100vh-2rem)] overflow-y-auto shadow-xl animate-[modalIn_250ms_ease-out]">
        {/* 1. Completion acknowledgment */}
        {isModuleComplete ? (
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle />
            <div>
              <p className="text-sm font-medium text-gray-900">
                {isSubmodule ? "Submodule" : "Module"} Complete
                {moduleTitle && <>: &ldquo;{moduleTitle}&rdquo;</>}
              </p>
              {parentTitle && (
                <p className="text-xs text-gray-500">from {parentTitle}</p>
              )}
            </div>
          </div>
        ) : completedTitle ? (
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle />
            <p className="text-gray-500 text-sm">
              Completed &ldquo;{completedTitle}&rdquo;
            </p>
          </div>
        ) : null}

        {/* 2. Optional section choices */}
        {optionalChoices.length > 0 && (
          <div>
            <p className="text-sm text-gray-700 mb-3">{optionalLabel}</p>
            <div className="flex flex-col gap-2">
              {optionalChoices.map((choice) => (
                <SectionChoiceButton
                  key={choice.index}
                  choice={choice}
                  onChoose={handleChoose}
                  variant="optional"
                />
              ))}
            </div>
          </div>
        )}

        {/* 3. Required section choices */}
        {requiredChoices.length > 0 && (
          <div className={optionalChoices.length > 0 ? "mt-4" : ""}>
            {optionalChoices.length > 0 ? (
              <p className="text-sm text-gray-700 mb-3">
                Or continue with the core material:
              </p>
            ) : requiredChoices.length > 1 ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {requiredChoices.length} section
                  {requiredChoices.length !== 1 ? "s" : ""} left to complete
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Complete the remaining sections to finish this module.
                </p>
              </>
            ) : null}
            <div className="flex flex-col gap-2">
              {requiredChoices.map((choice) => (
                <SectionChoiceButton
                  key={choice.index}
                  choice={choice}
                  onChoose={handleChoose}
                  variant="required"
                />
              ))}
            </div>
          </div>
        )}

        {/* 4. Next module link (when module complete and no required sections left) */}
        {nextModuleLink &&
          requiredChoices.filter((c) => !c.completed).length === 0 && (
            <div className={optionalChoices.length > 0 ? "mt-4" : ""}>
              {optionalChoices.length > 0 && (
                <p className="text-sm text-gray-700 mb-3">
                  Or continue to the next module:
                </p>
              )}
              <a
                href={nextModuleLink.href}
                className="w-full flex items-center justify-between gap-3 p-3.5 rounded-[10px] border-[1.5px] border-[#dea96c] bg-[#fdf8f0]/60 hover:border-[#d08838] hover:bg-[#fdf8f0] transition-colors text-left"
              >
                <span className="text-[15px] font-semibold text-[#7a470c]">
                  {nextModuleLink.label}
                </span>
                <svg
                  className="w-[18px] h-[18px] text-[#d08838] flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </a>
            </div>
          )}

        {/* Remaining required count note (when there are also optional choices shown) */}
        {requiredChoices.length > 0 &&
          optionalChoices.length > 0 &&
          requiredChoices.length > 1 && (
            <p className="text-xs text-gray-500 mt-3">
              {requiredChoices.length} sections left to complete
            </p>
          )}

        {/* 5. Footer links */}
        <div className="mt-4 flex flex-col items-center gap-1">
          {enrollLink && (
            <a
              href={enrollLink.href}
              className="w-full inline-block text-center text-[#9a5c10] py-2 px-4 hover:text-[#7a470c] transition-colors text-sm"
            >
              {enrollLink.label}
            </a>
          )}
          {courseLink && (
            <a
              href={courseLink.href}
              className="w-full inline-block text-center text-gray-500 py-2 px-4 hover:text-gray-700 transition-colors text-sm"
            >
              {courseLink.label}
            </a>
          )}
          <button
            onClick={onDismiss}
            className="w-full text-gray-400 py-2 px-4 hover:text-gray-600 transition-colors text-sm"
          >
            {isModuleComplete
              ? "Dismiss"
              : requiredChoices.length === 0
                ? "Skip"
                : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}
