import { LandingNav } from "@/components/LandingNav";
import { LandingFooter } from "@/components/LandingFooter";

export default function AboutPage() {
  return (
    <div style={{ fontFamily: "var(--landing-font-body)", backgroundColor: "var(--landing-bg)", color: "var(--landing-text)" }}>
      <LandingNav />
      <main className="pt-32 pb-20 px-4">
        <div className="max-w-2xl mx-auto">
          <h1
            className="text-4xl sm:text-5xl font-normal tracking-tight mb-8"
            style={{ fontFamily: "var(--landing-font-display)" }}
          >
            About Lens Academy
          </h1>
          <p className="text-lg" style={{ color: "var(--landing-text-muted)" }}>
            Content coming soon.
          </p>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
