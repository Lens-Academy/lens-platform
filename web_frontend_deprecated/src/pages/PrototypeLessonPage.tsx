// web_frontend/src/pages/PrototypeLessonPage.tsx

import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { UnifiedScrollLesson } from "../components/lesson-prototypes/prototype-a";
import { StickyVideoLesson } from "../components/lesson-prototypes/prototype-b";
import { ModalCheckpointLesson } from "../components/lesson-prototypes/prototype-c";
import { SideBySideLesson } from "../components/lesson-prototypes/prototype-d";
import { TravelingVideoLesson } from "../components/lesson-prototypes/prototype-e";
import { testLesson } from "../components/lesson-prototypes/testLessonData";
import { testLessonE } from "../components/lesson-prototypes/prototype-e/testLessonE";
import { createSession } from "../api/lessons";

export default function PrototypeLessonPage() {
  const { prototype } = useParams<{ prototype: string }>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create a session for the test lesson
  useEffect(() => {
    createSession("introduction")
      .then(setSessionId)
      .catch((err) => {
        console.error("Failed to create session:", err);
        setError("Failed to create session. Chat features will be limited.");
      });
  }, []);

  const renderPrototype = () => {
    switch (prototype) {
      case "a":
        return <UnifiedScrollLesson lesson={testLesson} sessionId={sessionId} />;
      case "b":
        return <StickyVideoLesson lesson={testLesson} sessionId={sessionId} />;
      case "c":
        return <ModalCheckpointLesson lesson={testLesson} sessionId={sessionId} />;
      case "d":
        return <SideBySideLesson lesson={testLesson} sessionId={sessionId} />;
      case "e":
        return <TravelingVideoLesson lesson={testLessonE} sessionId={sessionId} />;
      default:
        return (
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-4">Unknown Prototype</h1>
              <p className="text-gray-600 mb-4">Choose a prototype:</p>
              <div className="space-y-2">
                <a href="/prototype/a" className="block text-blue-600 hover:underline">
                  Prototype A: Unified Scroll
                </a>
                <a href="/prototype/b" className="block text-blue-600 hover:underline">
                  Prototype B: Sticky Video
                </a>
                <a href="/prototype/c" className="block text-blue-600 hover:underline">
                  Prototype C: Modal Checkpoints
                </a>
                <a href="/prototype/d" className="block text-blue-600 hover:underline">
                  Prototype D: Side-by-Side
                </a>
                <a href="/prototype/e" className="block text-blue-600 hover:underline">
                  Prototype E: Traveling Video
                </a>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      {error && (
        <div className="fixed top-0 left-0 right-0 bg-yellow-100 text-yellow-800 px-4 py-2 text-sm text-center z-50">
          {error}
        </div>
      )}
      {renderPrototype()}
    </>
  );
}
