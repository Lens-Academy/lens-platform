export default function ErrorPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-stone-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-300 mb-4">404</h1>
        <p className="text-xl text-slate-600 mb-8">Page not found</p>
        <a
          href="/"
          className="px-6 py-3 bg-emerald-500 text-white rounded-full font-medium hover:bg-emerald-600 transition-colors"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}
