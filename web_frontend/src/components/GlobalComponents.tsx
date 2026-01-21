import { useState, useCallback, useEffect } from "react";
import MobileWarning from "./MobileWarning";
import CookieBanner from "./CookieBanner";
import FeedbackButton from "./FeedbackButton";

export function GlobalComponents() {
  // Initialize to false to avoid hydration mismatch
  // (server renders false, client may have localStorage value)
  const [showMobileWarning, setShowMobileWarning] = useState(false);

  useEffect(() => {
    // Check localStorage on client only
    const dismissed = localStorage.getItem("mobileWarningDismissed");
    if (!dismissed) {
      setShowMobileWarning(true);
    }
  }, []);

  const handleContinueAnyway = useCallback(() => {
    setShowMobileWarning(false);
    localStorage.setItem("mobileWarningDismissed", "true");
  }, []);

  return (
    <>
      {showMobileWarning && <MobileWarning onContinue={handleContinueAnyway} />}
      <CookieBanner />
      <FeedbackButton />
    </>
  );
}
