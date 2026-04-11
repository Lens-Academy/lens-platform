/**
 * TestRoleplayCard - Roleplay wrapper for test sections.
 *
 * Handles three visual states (matching TestQuestionCard pattern):
 * - Hidden: item not yet revealed (renders nothing)
 * - Active: roleplay is being played (renders full RoleplaySection)
 * - Collapsed: roleplay completed, shows single-line "Completed" indicator
 *
 * When the user clicks "End Conversation" in the active RoleplaySection,
 * the onComplete callback fires to advance the test state machine.
 */

import type { RoleplaySegment } from "@/types/module";
import RoleplaySection from "./RoleplaySection";

interface TestRoleplayCardProps {
  segment: RoleplaySegment;
  moduleSlug: string;
  itemIndex: number;
  itemCount: number;
  isActive: boolean;
  isCompleted: boolean;
  isRevealed: boolean;
  onComplete: () => void;
}

export default function TestRoleplayCard({
  segment,
  moduleSlug,
  itemIndex,
  itemCount,
  isActive,
  isCompleted,
  isRevealed,
  onComplete,
}: TestRoleplayCardProps) {
  // Not yet revealed - render nothing
  if (!isRevealed) {
    return null;
  }

  // Completed and not active - collapsed state
  if (isCompleted && !isActive) {
    return (
      <div className="py-3 px-4 flex items-center gap-3 text-stone-500">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <span className="text-sm">
          Roleplay {itemIndex + 1} of {itemCount}
        </span>
        <span className="text-xs text-emerald-600">Completed</span>
      </div>
    );
  }

  // Active or revealed: render full RoleplaySection with completion callback
  return (
    <div className="py-2">
      <div className="px-4 mb-1 text-xs text-stone-400">
        Roleplay {itemIndex + 1} of {itemCount}
      </div>
      <RoleplaySection
        segment={segment}
        moduleSlug={moduleSlug}
        onComplete={onComplete}
      />
    </div>
  );
}
