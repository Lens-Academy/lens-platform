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

  // Find the first required section (skip target)
  const requiredChoice = choices.find((c) => !c.optional);
  const optionalChoices = choices.filter((c) => c.optional);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onDismiss();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg p-8 max-w-lg w-full mx-4 shadow-xl">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          What&rsquo;s Next?
        </h2>
        {completedTitle && (
          <p className="text-gray-500 text-sm mb-5">
            You&rsquo;ve completed &ldquo;{completedTitle}&rdquo;
          </p>
        )}

        <div className="flex flex-col gap-3">
          {optionalChoices.map((choice) => (
            <button
              key={choice.index}
              onClick={() => onChoose(choice.index)}
              className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-left"
            >
              <div className="flex-shrink-0 mt-0.5 text-gray-400">
                <StageIcon type={choice.type} small />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {choice.title}
                  </span>
                  <span className="text-xs text-gray-400 border border-gray-200 rounded px-1">
                    Optional
                  </span>
                </div>
                {choice.tldr && (
                  <p className="text-sm text-gray-500 mt-1">{choice.tldr}</p>
                )}
                {choice.duration != null && choice.duration > 0 && (
                  <span className="text-xs text-gray-400 mt-1 inline-block">
                    {formatDurationMinutes(choice.duration)}
                  </span>
                )}
              </div>
            </button>
          ))}

          {requiredChoice && (
            <button
              onClick={() => onChoose(requiredChoice.index)}
              className="w-full py-3 px-4 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors mt-1"
            >
              Continue: {requiredChoice.title}
            </button>
          )}

          {!requiredChoice && optionalChoices.length > 0 && (
            <button
              onClick={onDismiss}
              className="w-full text-gray-500 py-2 px-4 hover:text-gray-700 transition-colors text-sm"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
