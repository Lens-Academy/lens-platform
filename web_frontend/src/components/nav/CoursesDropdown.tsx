const COURSES = [
  {
    label: "Superintelligence 101",
    href: "/course/superintelligence-101",
    badge: "start here",
  },
  {
    label: "Navigating Superintelligence",
    href: "/course/navigating-asi",
  },
] as const;

export function CoursesDropdown({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col">
      {COURSES.map((course) => (
        <a
          key={course.href}
          href={course.href}
          onClick={onNavigate}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border)]/30 transition-colors duration-150"
        >
          {course.label}
          {"badge" in course && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-lens-orange-100)] text-[var(--color-lens-orange-600)]">
              {course.badge}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
