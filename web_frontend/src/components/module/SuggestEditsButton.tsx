import { lensEditorUrl } from "@/config";
import { Popover } from "../Popover";

type SuggestEditsButtonProps = {
  articlePath?: string | null;
  articleTitle?: string | null;
  lensPath?: string | null;
  lensTitle?: string | null;
  modulePath?: string | null;
  moduleTitle?: string;
  hidden?: boolean;
};

function EditLink({
  href,
  kind,
  title,
}: {
  href: string;
  kind: string;
  title: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-lens-orange-50 hover:bg-lens-orange-100 transition-colors"
    >
      <div>
        <span className="text-sm font-semibold text-lens-orange-600">
          {kind}
        </span>
        <span className="text-sm text-gray-800 ml-1.5">{title}</span>
      </div>
      <svg
        className="w-3.5 h-3.5 text-lens-orange-400 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}

export default function SuggestEditsButton({
  articlePath,
  articleTitle,
  lensPath,
  lensTitle,
  modulePath,
  moduleTitle,
  hidden,
}: SuggestEditsButtonProps) {
  const hasArticle = !!(articlePath && articlePath !== lensPath);
  const hasLens = !!lensPath;
  const hasModule = !!(
    modulePath &&
    modulePath !== lensPath &&
    modulePath !== articlePath
  );

  if (!hasLens && !hasArticle && !hasModule) return null;

  const buttonClasses = `fixed right-4 z-30 flex items-center justify-center w-8 h-8 bg-white/80 border border-gray-200 rounded-md shadow-sm hover:bg-white hover:border-gray-300 transition-all active:scale-95 ${
    hidden ? "opacity-0 pointer-events-none" : ""
  }`;
  const buttonStyle = {
    top: "calc(var(--module-header-height) + 58px)",
  };

  const pencilIcon = (
    <svg
      className="w-4 h-4 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
      />
    </svg>
  );

  // Single option: direct link, no popover
  const allPaths = [articlePath, lensPath, modulePath].filter(Boolean);
  const uniquePaths = [...new Set(allPaths)];
  if (uniquePaths.length === 1) {
    return (
      <a
        href={lensEditorUrl(uniquePaths[0]!)}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses}
        style={buttonStyle}
        title="Suggest edits or leave a comment"
        aria-label="Suggest edits or leave a comment"
      >
        {pencilIcon}
      </a>
    );
  }

  return (
    <Popover
      placement="bottom-end"
      className="bg-white border border-gray-200 rounded-xl shadow-lg z-50 w-[340px]"
      content={(close) => (
        <div className="p-4" onClick={close}>
          <div className="text-base font-semibold text-gray-900 mb-3">
            Suggest edits or comment
          </div>

          {hasLens && (
            <div className="mb-3">
              <p className="text-sm text-gray-600 mb-1.5">You are viewing:</p>
              <EditLink
                href={lensEditorUrl(lensPath!)}
                kind="Lens:"
                title={lensTitle || "this section"}
              />
            </div>
          )}

          {hasArticle && (
            <div className="mb-3">
              <p className="text-sm text-gray-600 mb-1.5">It contains:</p>
              <EditLink
                href={lensEditorUrl(articlePath!)}
                kind="Article:"
                title={articleTitle || "source article"}
              />
            </div>
          )}

          {hasModule && (
            <div className="mb-3">
              <p className="text-sm text-gray-600 mb-1.5">Part of:</p>
              <EditLink
                href={lensEditorUrl(modulePath!)}
                kind="Module:"
                title={moduleTitle || "this module"}
              />
            </div>
          )}

          <p className="text-sm text-gray-600">
            Click on the file you'd like to review.
          </p>
        </div>
      )}
    >
      <button
        className={buttonClasses}
        style={buttonStyle}
        title="Suggest edits or leave a comment"
        aria-label="Suggest edits or leave a comment"
      >
        {pencilIcon}
      </button>
    </Popover>
  );
}
