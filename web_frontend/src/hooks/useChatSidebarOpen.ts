import { useEffect, useState } from "react";

export function useChatSidebarOpen(): boolean {
  const [chatOpen, setChatOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("chat-sidebar-pref") === "open",
  );

  useEffect(() => {
    const sync = () =>
      setChatOpen(localStorage.getItem("chat-sidebar-pref") === "open");
    window.addEventListener("chat-sidebar-pref-change", sync);
    return () => window.removeEventListener("chat-sidebar-pref-change", sync);
  }, []);

  return chatOpen;
}
