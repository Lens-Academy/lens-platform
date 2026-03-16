import { StageIcon } from "./StageProgressBar";
import { formatDurationMinutes } from "../../utils/duration";

export interface SectionChoice {
  index: number;
  type: "lens-video" | "lens-article" | "page" | "test";
  title: string;
  tldr?: string;
  optional: boolean;
  duration?: number | null;
}

interface Props {
  isOpen: boolean;
  completedTitle?: string;
  choices: SectionChoice[];
  onChoose: (sectionIndex: number) => void;
  onDismiss: () => void;
}

export default function SectionChoiceModal({
  isOpen,
  completedTitle,
  choices,
  onChoose,
  onDismiss,
}: Props) {
  if (!isOpen || choices.length === 0) return null;

  const requiredChoice = choices.find((c) => !c.optional);
  const optionalChoices = choices.filter((c) => c.optional);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onDismiss();
  };

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
        {completedTitle && (
          <div className="flex items-center gap-2 mb-4">
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
            <p className="text-gray-500 text-sm">
              Completed &ldquo;{completedTitle}&rdquo;
            </p>
          </div>
        )}

        {/* Optional sections first */}
        {optionalChoices.length > 0 && (
          <div>
            <p className="text-sm text-gray-700 mb-3">
              {optionalLabel}
            </p>
            <div className="flex flex-col gap-2">
              {optionalChoices.map((choice) => (
                <button
                  key={choice.index}
                  onClick={() => onChoose(choice.index)}
                  className="w-full flex items-start gap-3 p-3 rounded-[10px] border-[1.5px] border-gray-200 bg-white hover:border-[#dea96c] hover:bg-[#fdf8f0] transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded-full border-2 border-dashed border-gray-400 bg-white flex items-center justify-center flex-shrink-0 mt-0.5 text-gray-400">
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
                      {choice.type === "lens-video"
                        ? "Video"
                        : choice.type === "lens-article"
                          ? "Article"
                          : choice.type === "test"
                            ? "Test"
                            : "Page"}
                      {choice.duration != null &&
                        choice.duration > 0 &&
                        ` · ${formatDurationMinutes(choice.duration)}`}
                    </div>
                    {choice.tldr && (
                      <p className="text-xs text-gray-700 mt-1 leading-relaxed">
                        {choice.tldr}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Required section */}
        {requiredChoice && (
          <div className={optionalChoices.length > 0 ? "mt-4" : ""}>
            {optionalChoices.length > 0 && (
              <p className="text-sm text-gray-700 mb-3">
                Or continue with the core material:
              </p>
            )}
            <button
              onClick={() => onChoose(requiredChoice.index)}
              className="w-full flex items-start gap-3 p-3.5 rounded-[10px] border-[1.5px] border-[#dea96c] bg-[#fdf8f0]/60 hover:border-[#d08838] hover:bg-[#fdf8f0] transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-full border-2 border-gray-400 flex items-center justify-center flex-shrink-0 mt-0.5 text-gray-400">
                <StageIcon type={requiredChoice.type} small />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-[#7a470c]">
                  {requiredChoice.title}
                </div>
                <div className="text-xs text-[#9a5c10] mt-0.5">
                  {requiredChoice.type === "lens-video"
                    ? "Video"
                    : requiredChoice.type === "lens-article"
                      ? "Article"
                      : requiredChoice.type === "test"
                        ? "Test"
                        : "Page"}
                  {requiredChoice.duration != null &&
                    requiredChoice.duration > 0 &&
                    ` · ${formatDurationMinutes(requiredChoice.duration)}`}
                </div>
                {requiredChoice.tldr && (
                  <p className="text-xs text-gray-700 mt-1 leading-relaxed">
                    {requiredChoice.tldr}
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Skip — only when no required section */}
        {!requiredChoice && optionalChoices.length > 0 && (
          <button
            onClick={onDismiss}
            className="w-full text-[#9a5c10] py-2 px-4 hover:text-[#7a470c] transition-colors text-sm mt-3"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
