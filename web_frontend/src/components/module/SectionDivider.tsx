// web_frontend/src/components/module/SectionDivider.tsx

type SectionDividerProps = {
  type: "video" | "article" | "chat" | "lens-video" | "lens-article" | "page" | "test";
  optional?: boolean;
  title?: string;
};

function Icon({ type }: { type: "video" | "article" }) {
  if (type === "article") {
    return (
      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Video
  return (
    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function SectionDivider({
  type,
  optional,
  title,
}: SectionDividerProps) {
  // Map section types to icon types
  // lens-video and video use the video icon
  // lens-article, article, chat, and page use the article icon
  const iconType =
    type === "video" || type === "lens-video" ? "video" : "article";

  return (
    <div className="flex flex-col items-center gap-2 px-4 sm:px-6 py-6">
      <div className="flex items-center gap-4 w-full">
        <div className="flex-1 border-t border-gray-300" />
        <div className="flex items-center gap-2 text-gray-600">
          <Icon type={iconType} />
          {title && <span className="text-xl font-medium">{title}</span>}
        </div>
        <div className="flex-1 border-t border-gray-300" />
      </div>
      {optional && (
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
          Optional
        </span>
      )}
    </div>
  );
}
