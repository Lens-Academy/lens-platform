export default function Page() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--brand-bg)]">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-[var(--brand-text-muted)] mb-4">
          404
        </h1>
        <p className="text-xl text-[var(--brand-text-muted)] mb-8">
          Page not found
        </p>
        <a
          href="/"
          className="px-6 py-3 bg-lens-orange-500 text-white rounded-full font-medium hover:bg-lens-orange-600 transition-colors"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}
