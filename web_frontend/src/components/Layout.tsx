import { Outlet } from "react-router";

const DISCORD_INVITE_URL =
  import.meta.env.VITE_DISCORD_INVITE_URL || "https://discord.gg/YOUR_INVITE";

export default function Layout() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-white/70 border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="/" className="text-xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
              Coursey McCourseface
            </a>
            <a
              href={DISCORD_INVITE_URL}
              className="px-5 py-2 rounded-full border-2 border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Join Our Discord
            </a>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24">
        <Outlet />
      </main>
    </div>
  );
}
