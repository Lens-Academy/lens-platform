import { useState } from "react";

interface MobileWarningProps {
  onContinue: () => void;
}

function checkMobile() {
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = [
    "android",
    "webos",
    "iphone",
    "ipad",
    "ipod",
    "blackberry",
    "windows phone",
  ];
  return mobileKeywords.some((keyword) => userAgent.includes(keyword));
}

export default function MobileWarning({ onContinue }: MobileWarningProps) {
  const [isMobile] = useState(checkMobile);

  if (!isMobile) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-slate-900 z-[9999] flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Desktop Only</h1>
        <p className="text-gray-300 mb-6">
          Lens Academy is currently only available on desktop devices. Please
          visit on a desktop or laptop computer for the full experience.
        </p>
        <button
          onClick={onContinue}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          Continue Anyway
        </button>
        <p className="text-sm text-gray-500 mt-4">
          Limited view - some features may not work properly
        </p>
      </div>
    </div>
  );
}
