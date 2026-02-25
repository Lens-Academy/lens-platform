/**
 * Extract character name from roleplay ai-instructions text.
 *
 * Looks for common patterns:
 * - "You are [Name]" at start
 * - "Character: [Name]" or "Name: [Name]" on any line
 * Falls back to "Character" if no match found.
 */
export function extractCharacterName(aiInstructions: string): string {
  // Match "You are [Name]" at start of instructions
  // Name: starts with uppercase, 1-30 chars, ends at period, comma, or newline
  const youAreMatch = aiInstructions.match(
    /^You are\s+([A-Z][a-zA-Z\s]{1,30}?)[.,\n]/,
  );
  if (youAreMatch) return youAreMatch[1].trim();

  // Match "Character: [Name]" or "Name: [Name]" on any line
  const labelMatch = aiInstructions.match(
    /^(?:Character|Name):?\s+([A-Z][a-zA-Z\s]{1,30}?)[.,\n]/m,
  );
  if (labelMatch) return labelMatch[1].trim();

  return "Character"; // Fallback
}
