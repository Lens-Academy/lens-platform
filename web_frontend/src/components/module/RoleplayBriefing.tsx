/**
 * RoleplayBriefing - Scenario briefing card displayed above the conversation.
 *
 * Shows the scenario context (content:: field) so the student understands
 * the roleplay situation. Always visible regardless of text display toggle.
 */

type RoleplayBriefingProps = {
  content: string;
};

export default function RoleplayBriefing({ content }: RoleplayBriefingProps) {
  return (
    <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-indigo-500 mb-2">
        Scenario
      </div>
      <div className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
