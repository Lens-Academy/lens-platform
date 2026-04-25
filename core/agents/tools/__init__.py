"""Coach tool executor registry.

Aggregates all tool schemas and provides a single dispatch function.
Also re-exports transfer tool builders for backward compatibility.
"""

import json
import logging

from .transfer import (  # noqa: F401 — re-exports for backward compatibility
    build_transfer_tool,
    build_all_transfer_tools,
    AGENT_REGISTRY,
)

from .memory_tools import (
    MEMORY_TOOL_SCHEMAS,
    execute_read_file,
    execute_edit_file,
    execute_append_memory,
)
from .progress_tools import (
    PROGRESS_TOOL_SCHEMAS,
    execute_get_my_progress,
    execute_get_my_upcoming_deadlines,
)
from .scheduling_tools import (
    SCHEDULING_TOOL_SCHEMAS,
    execute_schedule_reminder,
    execute_list_my_reminders,
    execute_cancel_reminder,
)

logger = logging.getLogger(__name__)

COACH_TOOL_SCHEMAS = tuple(MEMORY_TOOL_SCHEMAS + PROGRESS_TOOL_SCHEMAS + SCHEDULING_TOOL_SCHEMAS)


async def coach_tool_executor(tool_call: dict, user_id: int) -> str:
    """Dispatch a tool call to the appropriate handler.

    Args:
        tool_call: OpenAI-format tool call dict with function.name and function.arguments.
        user_id: The authenticated user's ID (injected, not from LLM).

    Returns:
        String result to feed back to the LLM as a tool result.
    """
    func = tool_call.get("function", {})
    name = func.get("name", "")

    try:
        args = json.loads(func.get("arguments", "{}"))
    except json.JSONDecodeError:
        return "Invalid tool arguments (malformed JSON)."

    try:
        if name == "read_file":
            return await execute_read_file(user_id, args["filename"])
        elif name == "edit_file":
            return await execute_edit_file(user_id, args["filename"], args["old_string"], args["new_string"])
        elif name == "append_memory":
            return await execute_append_memory(user_id, args["note"])
        elif name == "get_my_progress":
            return await execute_get_my_progress(user_id)
        elif name == "get_my_upcoming_deadlines":
            return await execute_get_my_upcoming_deadlines(user_id)
        elif name == "schedule_reminder":
            return await execute_schedule_reminder(user_id, args["fire_at"], args["reason"])
        elif name == "list_my_reminders":
            return await execute_list_my_reminders(user_id)
        elif name == "cancel_reminder":
            return await execute_cancel_reminder(user_id, args["job_id"])
        else:
            return f"Unknown tool: {name}"
    except KeyError as e:
        return f"Missing required parameter: {e}"
    except Exception:
        logger.exception("tool_execution_failed", extra={"tool": name, "user_id": user_id})
        return f"Tool '{name}' failed unexpectedly. Please try again."
