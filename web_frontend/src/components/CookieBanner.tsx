import { useState, useEffect } from "react";
import { detectUserCountry, requiresCookieConsent } from "../geolocation";
import {
  optIn,
  optOut,
  hasConsentChoice,
  optInMarketing,
  optOutMarketing,
  hasMarketingConsentChoice,
} from "../analytics";
import { initSentry } from "../errorTracking";

export default function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkConsent() {
      if (hasConsentChoice() && hasMarketingConsentChoice()) {
        setIsLoading(false);
        return;
      }
      const country = await detectUserCountry();
      const needsConsent = requiresCookieConsent(country);
      if (needsConsent) {
        setShowBanner(true);
      } else {
        optIn();
        optInMarketing();
        initSentry();
      }
      setIsLoading(false);
    }
    checkConsent();
  }, []);

  const handleAcceptAll = () => {
    optIn();
    optInMarketing();
    initSentry();
    setShowBanner(false);
  };

  const handleDeclineAll = () => {
    optOut();
    optOutMarketing();
    setShowBanner(false);
  };

  if (isLoading || !showBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-slate-900 border-b border-slate-700 p-4 z-50 shadow-lg">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-slate-300">
            We use cookies to understand how you use this platform (analytics)
            and how you found us (marketing).{" "}
            <a
              href="/privacy"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Learn more
            </a>
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <button
            onClick={handleDeclineAll}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Decline All
          </button>
          <button
            onClick={handleAcceptAll}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}
