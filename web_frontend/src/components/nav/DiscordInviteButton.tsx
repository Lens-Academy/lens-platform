import { DISCORD_INVITE_URL } from "../../config";
import { DiscordIcon } from "../icons/DiscordIcon";

export function DiscordInviteButton() {
  return (
    <a
      href={DISCORD_INVITE_URL}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[var(--brand-text)] font-medium text-sm hover:bg-lens-gold-50 transition-all duration-200"
    >
      <DiscordIcon />
      Community
    </a>
  );
}
