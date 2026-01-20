"use client";

import { useState, useSyncExternalStore, useCallback } from "react";
import { optIn, optOut, hasConsent } from "../analytics";
import { initSentry } from "../errorTracking";

interface CookieSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

// Simple store for consent state that syncs with localStorage
const CONSENT_KEY = "analytics-consent";

function subscribeToConsent(callback: () => void) {
  const handleStorage = (e: StorageEvent) => {
    if (e.key === CONSENT_KEY) callback();
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

function getConsentSnapshot() {
  return hasConsent();
}

export default function CookieSettings({
  isOpen,
  onClose,
}: CookieSettingsProps) {
  // Use useSyncExternalStore to properly sync with localStorage
  const consentFromStorage = useSyncExternalStore(
    subscribeToConsent,
    getConsentSnapshot,
    getConsentSnapshot
  );

  // Local optimistic state for immediate UI feedback
  const [localConsent, setLocalConsent] = useState<boolean | null>(null);

  // Use local state if set, otherwise use storage value
  const analyticsEnabled = localConsent ?? consentFromStorage;

  const handleToggle = useCallback((enabled: boolean) => {
    setLocalConsent(enabled);
    if (enabled) {
      optIn();
      initSentry();
    } else {
      optOut();
    }
  }, []);

  // Reset local state when modal closes
  const handleClose = useCallback(() => {
    setLocalConsent(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">Cookie Settings</h2>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Essential Cookies */}
          <div className="pb-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900">
                Essential Cookies
              </h3>
              <span className="text-sm text-slate-500">Always Active</span>
            </div>
            <p className="text-sm text-slate-600">
              Required for login and core functionality. These cannot be
              disabled.
            </p>
          </div>

          {/* Analytics Cookies */}
          <div className="pb-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900">
                Analytics Cookies
              </h3>
              <button
                onClick={() => handleToggle(!analyticsEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  analyticsEnabled ? "bg-blue-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    analyticsEnabled ? "translate-x-6" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Help us understand how users interact with the platform to improve
              the experience. No marketing, no tracking, no data selling.
            </p>
          </div>

          {/* Privacy Policy Link */}
          <div className="pt-2">
            <a
              href="/privacy"
              className="text-sm text-blue-600 hover:text-blue-500 underline"
              onClick={handleClose}
            >
              View full privacy policy
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
