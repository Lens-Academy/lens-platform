// web_frontend/src/components/unified-lesson/OptionalBanner.tsx

type OptionalBannerProps = {
  stageType: "article" | "video";
  onSkip: () => void;
};

export default function OptionalBanner({
  stageType,
  onSkip,
}: OptionalBannerProps) {
  return (
    <div className="bg-sky-50 rounded-lg px-5 py-4 mb-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <img
          src="/assets/Logo only.png"
          alt="Lens Academy"
          className="w-5 h-5 flex-shrink-0"
        />
        <span className="text-sm font-medium" style={{ color: '#0d5a6a' }}>
          This {stageType} is optional
        </span>
      </div>
      <button
        onClick={onSkip}
        className="text-sm font-medium whitespace-nowrap hover:underline"
        style={{ color: '#0d5a6a' }}
      >
        Skip to next →
      </button>
    </div>
  );
}
