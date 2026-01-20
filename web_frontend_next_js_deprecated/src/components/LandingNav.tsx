"use client";

import Link from "next/link";
import { DiscordInviteButton, UserMenu } from "./nav";

export function LandingNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-stone-50/70 border-b border-slate-200/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/assets/Logo only.png"
              alt="Lens Academy"
              className="h-8"
            />
            <span className="text-xl font-semibold text-slate-800">
              Lens Academy
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/course"
              className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
            >
              Course
            </Link>
            <DiscordInviteButton />
            <UserMenu signInRedirect="/course" />
          </div>
        </div>
      </div>
    </nav>
  );
}
