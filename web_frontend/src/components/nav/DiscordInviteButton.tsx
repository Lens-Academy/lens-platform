import { DISCORD_INVITE_URL } from "../../config";

export function DiscordInviteButton() {
  return (
    <a
      href={DISCORD_INVITE_URL}
      className="px-5 py-2 rounded-full border-2 border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
    >
      Join us on Discord
    </a>
  );
}
