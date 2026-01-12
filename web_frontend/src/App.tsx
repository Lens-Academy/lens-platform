import { useState, useCallback, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import MobileWarning from "./components/MobileWarning";
import CookieBanner from "./components/CookieBanner";
import FeedbackButton from "./components/FeedbackButton";
import Home from "./pages/Home";
import Signup from "./pages/Signup";
import Availability from "./pages/Availability";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import UnifiedLesson from "./pages/UnifiedLesson";
import CourseOverview from "./pages/CourseOverview";
import Facilitator from "./pages/Facilitator";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import { initPostHog, capturePageView, hasConsent } from "./analytics";
import { initSentry } from "./errorTracking";

// Initialize analytics if user previously consented
if (hasConsent()) {
  initPostHog();
  initSentry();
}

function App() {
  const [showMobileWarning, setShowMobileWarning] = useState(true);
  const location = useLocation();

  const handleContinueAnyway = useCallback(() => {
    setShowMobileWarning(false);
  }, []);

  // Track page views on route change
  useEffect(() => {
    capturePageView(location.pathname);
  }, [location.pathname]);

  return (
    <>
      {showMobileWarning && <MobileWarning onContinue={handleContinueAnyway} />}
      <Routes>
      {/* Full-screen pages (no Layout) */}
      <Route path="/lesson/:lessonId" element={<UnifiedLesson />} />
      <Route path="/course/:courseId/lesson/:lessonId" element={<UnifiedLesson />} />
      <Route path="/course/:courseId" element={<CourseOverview />} />
      <Route path="/course" element={<CourseOverview />} />

      {/* Standard pages with Layout */}
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/auth/code" element={<Auth />} />
        <Route path="/facilitator" element={<Facilitator />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
      <CookieBanner />
      <FeedbackButton />
    </>
  );
}

export default App;
