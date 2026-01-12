import { MessageSquare } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfcSdjQqNn6L-6bHAHJCVcKkSdRoEe4D47euBcrKkMlhHHIQA/viewform";
const EMAIL_ENTRY_ID = "entry.793821915";

export default function FeedbackButton() {
  const { user } = useAuth();

  const handleClick = () => {
    let url = FEEDBACK_FORM_URL;
    if (user?.email) {
      url += `?${EMAIL_ENTRY_ID}=${encodeURIComponent(user.email)}`;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed bottom-6 left-6 z-50">
      <button
        onClick={handleClick}
        className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-medium rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 cursor-pointer"
        aria-label="Send feedback"
      >
        <MessageSquare size={20} />
        <span>Feedback</span>
      </button>
    </div>
  );
}
