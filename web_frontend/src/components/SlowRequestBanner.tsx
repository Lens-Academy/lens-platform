import { useEffect, useState } from "react";

export default function SlowRequestBanner() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const pending = new Set<string>();
    const sync = () => setPendingCount(pending.size);

    const onSlow = (e: Event) => {
      const url = (e as CustomEvent<{ url: string }>).detail?.url;
      if (!url) return;
      pending.add(url);
      sync();
    };
    const onSettled = (e: Event) => {
      const url = (e as CustomEvent<{ url: string }>).detail?.url;
      if (!url) return;
      pending.delete(url);
      sync();
    };

    window.addEventListener("api:slow-request", onSlow);
    window.addEventListener("api:request-settled", onSettled);
    return () => {
      window.removeEventListener("api:slow-request", onSlow);
      window.removeEventListener("api:request-settled", onSettled);
    };
  }, []);

  if (pendingCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md bg-amber-50 border border-amber-300 text-amber-900 rounded-lg shadow-lg px-4 py-3 text-sm"
    >
      Sorry, this is taking a while. We&rsquo;re not sure if the page is going
      to load. You can keep waiting, but it might be broken. The error has been
      reported.
    </div>
  );
}
