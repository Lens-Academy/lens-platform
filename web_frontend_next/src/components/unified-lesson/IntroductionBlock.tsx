// Introductory notes for articles/videos
// Shows Lens Academy branding with contextual intro text

type IntroductionBlockProps = {
  text: string;
};

export default function IntroductionBlock({ text }: IntroductionBlockProps) {
  // not-prose prevents Tailwind Typography from adding extra spacing
  return (
    <div className="not-prose bg-sky-50 rounded-lg px-5 py-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <img
          src="/assets/Logo only.png"
          alt="Lens Academy"
          className="w-5 h-5"
        />
        <span className="text-sm font-medium" style={{ color: '#0d5a6a' }}>Info before reading/watching</span>
      </div>
      <p className="text-gray-700 leading-relaxed text-[15px]">{text}</p>
    </div>
  );
}
