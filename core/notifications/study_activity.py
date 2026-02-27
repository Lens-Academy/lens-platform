"""Daily study activity messages for group channels.

Posts one Discord message per group per day that builds up as members
complete sections, showing real-time study activity with early-bird callouts.
"""

import logging

logger = logging.getLogger(__name__)


def render_study_activity_message(entries: list[dict]) -> str | None:
    """Render the study activity message from structured entry data.

    Args:
        entries: List of dicts with keys: discord_id, display_name,
                 module_title, sections_completed, sections_total,
                 module_completed, early_bird_days

    Returns:
        Formatted Discord message string, or None if no entries.
    """
    if not entries:
        return None

    # Sort: completed first, then in-progress
    sorted_entries = sorted(entries, key=lambda e: (not e["module_completed"],))

    lines = ["\U0001f4da **Today's Study Activity**", ""]

    for entry in sorted_entries:
        mention = f"<@{entry['discord_id']}>"
        name = entry["display_name"]
        module = f"*{entry['module_title']}*"
        sections = f"{entry['sections_completed']}/{entry['sections_total']} sections"

        if entry["module_completed"]:
            line = f"\U0001f389 {mention} {name} \u2014 completed {module}! ({sections}"
            if entry.get("early_bird_days") and entry["early_bird_days"] >= 2:
                line += f" \u00b7 early bird \u2014 {entry['early_bird_days']} days before meeting"
            line += ")"
        else:
            line = f"\U0001f4d6 {mention} {name} \u2014 studying {module} ({sections})"

        lines.append(line)

    return "\n".join(lines)
