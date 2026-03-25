export function StageIcon({
  type,
  displayType,
  small = false,
}: {
  type: string;
  displayType?: string;
  small?: boolean;
}) {
  // Test icon: checkmark
  if (type === "test") {
    const size = small ? "w-4 h-4" : "w-5 h-5";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Lens with displayType — use specific icon
  if (
    type === "lens" &&
    (displayType === "lens-video" || displayType === "lens-mixed")
  ) {
    const size = small ? "w-5 h-5" : "w-6 h-6";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Lens icon: same as article (default for lens, or lens-article)
  if (type === "lens") {
    const size = small ? "w-4 h-4" : "w-5 h-5";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Article icon
  if (type === "article") {
    const size = small ? "w-4 h-4" : "w-5 h-5";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Video icon
  if (type === "video") {
    const size = small ? "w-5 h-5" : "w-6 h-6";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Chat (default)
  const size = small ? "w-5 h-5" : "w-6 h-6";
  return (
    <svg className={size} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
        clipRule="evenodd"
      />
    </svg>
  );
}
