import { useHeaderLayout } from '../hooks/useHeaderLayout';
import StageProgressBar from './unified-lesson/StageProgressBar';
import { LessonDrawerToggle } from './unified-lesson/LessonDrawer';
import HeaderAuthStatus from './unified-lesson/HeaderAuthStatus';
import type { Stage } from '../types/unified-lesson';

interface LessonHeaderProps {
  lessonTitle: string;
  stages: Stage[];
  currentStageIndex: number;
  viewingStageIndex: number | null;
  isViewingOther: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onReturnToCurrent: () => void;
  onSkipSection: () => void;
  onDrawerOpen: () => void;
  onLoginClick: () => void;
}

export function LessonHeader({
  lessonTitle,
  stages,
  currentStageIndex,
  viewingStageIndex,
  isViewingOther,
  canGoPrevious,
  canGoNext,
  onStageClick,
  onPrevious,
  onNext,
  onReturnToCurrent,
  onSkipSection,
  onDrawerOpen,
  onLoginClick,
}: LessonHeaderProps) {
  const [{ needsTwoRows, needsTruncation }, refs] = useHeaderLayout();

  return (
    <header
      ref={refs.containerRef}
      className="relative bg-white border-b border-gray-200 px-4 py-3 z-40"
    >
      <div className={`flex ${needsTwoRows ? 'flex-col gap-3' : 'items-center justify-between'}`}>
        {/* First row: Logo/title + (progress bar if single row) + controls */}
        <div className="flex items-center justify-between">
          {/* Left section: Logo and title */}
          <div
            ref={refs.leftRef}
            className={`flex items-center gap-2 ${needsTruncation ? 'min-w-0' : ''} mr-4`}
          >
            <a href="/" className="flex items-center gap-1.5 shrink-0">
              <img src="/assets/Logo only.png" alt="Lens Academy" className="h-6" />
              <span className="text-lg font-semibold text-slate-800">Lens Academy</span>
            </a>
            <span className="text-slate-300 shrink-0">|</span>
            <h1
              className={`text-lg font-semibold text-gray-900 ${needsTruncation ? 'truncate' : ''}`}
            >
              {lessonTitle}
            </h1>
          </div>

          {/* Center section: Progress bar (inline if single row, hidden measurement otherwise) */}
          <div
            ref={refs.centerRef}
            className={`flex-shrink-0 ${needsTwoRows ? 'invisible absolute' : ''}`}
          >
            <StageProgressBar
              stages={stages}
              currentStageIndex={currentStageIndex}
              viewingStageIndex={viewingStageIndex}
              onStageClick={onStageClick}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
            />
          </div>

          {/* Right section: Controls */}
          <div
            ref={refs.rightRef}
            className="flex items-center gap-4 shrink-0"
          >
            {isViewingOther ? (
              <button
                onClick={onReturnToCurrent}
                className="text-emerald-600 hover:text-emerald-700 text-sm font-medium whitespace-nowrap"
              >
                Return to current →
              </button>
            ) : (
              <button
                onClick={onSkipSection}
                className="text-gray-500 hover:text-gray-700 text-sm cursor-pointer whitespace-nowrap"
              >
                Skip section
              </button>
            )}
            <LessonDrawerToggle onClick={onDrawerOpen} />
            <HeaderAuthStatus onLoginClick={onLoginClick} />
          </div>
        </div>

        {/* Second row: Progress bar (only if two-row mode) */}
        {needsTwoRows && (
          <div className="flex justify-center">
            <StageProgressBar
              stages={stages}
              currentStageIndex={currentStageIndex}
              viewingStageIndex={viewingStageIndex}
              onStageClick={onStageClick}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
            />
          </div>
        )}
      </div>
    </header>
  );
}
