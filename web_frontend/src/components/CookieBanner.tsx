import { useState, useEffect } from "react";
import { detectUserCountry, requiresCookieConsent } from "../geolocation";
import { optIn, optOut, hasConsentChoice } from "../analytics";
import { initSentry } from "../errorTracking";

export default function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkConsent() {
      // Already made a choice
      if (hasConsentChoice()) {
        setIsLoading(false);
        return;
      }

      // Detect country for GDPR check
      const country = await detectUserCountry();
      const needsConsent = requiresCookieConsent(country);

      if (needsConsent) {
        setShowBanner(true);
      } else {
        // Auto-consent for non-GDPR regions
        optIn();
        initSentry();
      }

      setIsLoading(false);
    }

    checkConsent();
  }, []);

  const handleAccept = () => {
    optIn();
    initSentry();
    setShowBanner(false);
  };

  const handleDecline = () => {
    optOut();
    setShowBanner(false);
  };

  if (isLoading || !showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 p-4 z-50 shadow-lg">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-slate-300">
            We care about AI Safety. We use analytics to understand how to
            improve this course platform.{" "}
            <strong className="text-white">
              No marketing, no data selling.
            </strong>{" "}
            <a
              href="/privacy"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Learn more
            </a>
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          {/* Equal buttons - GDPR compliant (no dark patterns) */}
          <button
            onClick={handleDecline}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Decline Analytics
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Accept Analytics
          </button>
        </div>
      </div>
    </div>
  );
}
