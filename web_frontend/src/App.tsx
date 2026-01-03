import { useState, useCallback } from "react";
import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import MobileWarning from "./components/MobileWarning";
import Home from "./pages/Home";
import Signup from "./pages/Signup";
import Availability from "./pages/Availability";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import UnifiedLesson from "./pages/UnifiedLesson";

function App() {
  const [showMobileWarning, setShowMobileWarning] = useState(true);

  const handleContinueAnyway = useCallback(() => {
    setShowMobileWarning(false);
  }, []);

  return (
    <>
      {showMobileWarning && <MobileWarning onContinue={handleContinueAnyway} />}
      <Routes>
      {/* Full-screen pages (no Layout) */}
      <Route path="/lesson/:lessonId" element={<UnifiedLesson />} />
      <Route path="/course/:courseId/lesson/:lessonId" element={<UnifiedLesson />} />

      {/* Standard pages with Layout */}
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/auth/code" element={<Auth />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </>
  );
}

export default App;
