import Link from "next/link";
import { LandingNav } from "@/components/LandingNav";

export default function LandingPage() {
  return (
    <div className="h-screen bg-stone-50 text-slate-900 antialiased flex flex-col overflow-hidden">
      <LandingNav />

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-4 pt-16 relative bg-white">
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-10">
            <span className="block mb-4">Understand AI Safety.</span>
            <span className="text-emerald-600">Help Save Humanity.</span>
          </h1>

          <div className="mb-10 max-w-2xl mx-auto">
            <p className="text-xl sm:text-2xl text-slate-700 font-medium mb-3">
              A free, high quality course on AI existential risk.
            </p>
            <p className="text-xl sm:text-2xl text-slate-500">
              No gatekeeping, no application process.
            </p>
            <p className="text-xl sm:text-2xl text-slate-500 mt-3">
              Get started today. It takes 5 minutes.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/course/default/module/introduction"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-emerald-500 text-white font-semibold text-lg hover:bg-emerald-600 transition-all duration-200 hover:shadow-xl hover:shadow-emerald-500/25 hover:-translate-y-0.5"
            >
              Start Learning
            </Link>
            <Link
              href="/signup"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full border-2 border-slate-200 text-slate-700 font-semibold text-lg hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Sign Up
            </Link>
          </div>
          <p className="text-sm text-slate-500 mt-6">
            Try our intro module first, or sign up directly for the full course.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} Lens Academy. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
