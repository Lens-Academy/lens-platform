const COURSES = [
  {
    label: "Machine God (start here)",
    href: "/course/machine-god",
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
          className="block px-3 py-2 rounded-md text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--brand-border)]/30 transition-colors duration-150"
        >
          {course.label}
        </a>
      ))}
    </div>
  );
}
