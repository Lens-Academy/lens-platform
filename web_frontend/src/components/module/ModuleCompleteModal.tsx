interface NextModule {
  slug: string;
  title: string;
}

interface Props {
  isOpen: boolean;
  moduleTitle?: string;
  courseId?: string; // Present when in /course/:courseId/module/:moduleId context
  isInSignupsTable?: boolean; // User has signed up for a cohort
  isInActiveGroup?: boolean; // User is in an active cohort group
  nextModule?: NextModule | null; // Next module in course, null if last module
  completedUnit?: number | null; // Unit number if just completed a unit
  onClose?: () => void; // Called when user clicks outside modal
}

/**
 * Modal shown when a module is completed.
 *
 * CTAs are context-aware based on:
 * - Route context (standalone module vs course module)
 * - Whether user is enrolled in a cohort
 * - Whether there's a next module in the course
 */
export default function ModuleCompleteModal({
  isOpen,
  moduleTitle,
  courseId,
  isInSignupsTable = false,
  isInActiveGroup = false,
  nextModule,
  completedUnit,
  onClose,
}: Props) {
  if (!isOpen) return null;

  const isInCourseContext = !!courseId;
  const hasNextModule = !!nextModule;
  const hasCompletedUnit = completedUnit != null;
  const isEnrolled = isInSignupsTable || isInActiveGroup;

  // Determine CTAs based on context
  // Standalone module (/module/:id):
  //   - Not enrolled: "Join Full Course" → /enroll, "View Course" → /course
  //   - Enrolled: "View Course" → /course
  // Course module (/course/:id/module/:mid):
  //   - Unit complete + not enrolled: "Join Full Course" → /enroll, "Return to Course" → /course/:id
  //   - Unit complete + enrolled: "Return to Course" → /course/:id (no secondary CTA)
  //   - Not enrolled: "Join Full Course" → /enroll, "Return to Course" → /course/:id
  //   - Enrolled + has next: "Next Module" → next module URL, "Return to Course" → /course/:id
  //   - Enrolled + no next: "Return to Course" → /course/:id

  let primaryCta: { label: string; href: string };
  let secondaryCta: { label: string; href: string } | null = null;
  let completionMessage: string;

  if (!isInCourseContext) {
    // Standalone module context
    completionMessage = moduleTitle
      ? `You've finished "${moduleTitle}".`
      : "Great work!";
    if (!isEnrolled) {
      primaryCta = { label: "Join the Full Course", href: "/enroll" };
      secondaryCta = { label: "View Course", href: "/course" };
    } else {
      primaryCta = { label: "View Course", href: "/course" };
    }
  } else {
    // Course module context
    const courseUrl = `/course/${courseId}`;

    if (hasCompletedUnit && !isEnrolled) {
      // Unit completion + not enrolled - prompt to join
      completionMessage = `This was the last module of Unit ${completedUnit}.`;
      primaryCta = { label: "Join the Full Course", href: "/enroll" };
      secondaryCta = { label: "Return to Course", href: courseUrl };
    } else if (hasCompletedUnit) {
      // Unit completion + enrolled - just show return
      completionMessage = `This was the last module of Unit ${completedUnit}.`;
      primaryCta = { label: "Return to Course", href: courseUrl };
      // No secondary CTA - don't prompt them to go to next unit yet
    } else if (!isEnrolled) {
      completionMessage = moduleTitle
        ? `You've finished "${moduleTitle}".`
        : "Great work!";
      primaryCta = { label: "Join the Full Course", href: "/enroll" };
      secondaryCta = { label: "Return to Course", href: courseUrl };
    } else if (hasNextModule) {
      completionMessage = moduleTitle
        ? `You've finished "${moduleTitle}".`
        : "Great work!";
      const nextModuleUrl = `/course/${courseId}/module/${nextModule!.slug}`;
      primaryCta = { label: `Next: ${nextModule!.title}`, href: nextModuleUrl };
      secondaryCta = { label: "Return to Course", href: courseUrl };
    } else {
      // End of course
      completionMessage = moduleTitle
        ? `You've finished "${moduleTitle}".`
        : "Great work!";
      primaryCta = { label: "Return to Course", href: courseUrl };
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 shadow-xl text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Module Complete!
        </h2>
        <p className="text-gray-600 mb-6">
          {completionMessage}{" "}
          {!hasCompletedUnit && "Ready to continue your AI safety journey?"}
        </p>
        <div className="flex flex-col gap-3">
          <a
            href={primaryCta.href}
            className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
          >
            {primaryCta.label}
          </a>
          {secondaryCta && (
            <a
              href={secondaryCta.href}
              className="w-full text-gray-600 py-2 px-4 hover:text-gray-800 transition-colors"
            >
              {secondaryCta.label}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
