import { useState, useCallback, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { copyToClipboard } from "@/utils/copyChat";

type CopyButtonProps = {
  getText: () => string;
  /** Icon size in px (default 14) */
  size?: number;
  className?: string;
  label?: string;
};

export function CopyButton({
  getText,
  size = 14,
  className = "",
  label = "Copy",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const ok = await copyToClipboard(getText());
      if (ok) {
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      }
    },
    [getText],
  );

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center justify-center rounded p-1 transition-colors ${
        copied
          ? "text-green-600"
          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
      } ${className}`}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied!" : label}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}
