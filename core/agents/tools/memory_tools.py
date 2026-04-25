"""Memory tools: read_file, edit_file, append_memory."""

from datetime import date

from core.agents.user_files import load_user_files, save_user_file, VALID_FILENAMES

MEMORY_SOFT_LIMIT = 10_000


MEMORY_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "Read one of your per-user files: agent_style.md, user.md, or memory.md. "
                "Returns the file content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "File to read: agent_style.md, user.md, or memory.md",
                    },
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Surgical find-and-replace within a per-user file. "
                "old_string must match exactly once in the file. "
                "Read the file first to see current content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "File to edit: agent_style.md, user.md, or memory.md",
                    },
                    "old_string": {
                        "type": "string",
                        "description": "Exact text to find (must appear exactly once)",
                    },
                    "new_string": {
                        "type": "string",
                        "description": "Replacement text",
                    },
                },
                "required": ["filename", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "append_memory",
            "description": (
                "Append a timestamped note to memory.md. "
                "Use this for observations, decisions, or patterns you've noticed about the user."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note": {
                        "type": "string",
                        "description": "The note to append",
                    },
                },
                "required": ["note"],
            },
        },
    },
]


async def execute_read_file(user_id: int, filename: str) -> str:
    if filename not in VALID_FILENAMES:
        return f"Unknown file: {filename}. Valid files: {', '.join(sorted(VALID_FILENAMES))}"
    files = await load_user_files(user_id)
    content = files[filename]
    return content if content else "(empty)"


async def execute_edit_file(
    user_id: int, filename: str, old_string: str, new_string: str
) -> str:
    if filename not in VALID_FILENAMES:
        return f"Unknown file: {filename}. Valid files: {', '.join(sorted(VALID_FILENAMES))}"

    files = await load_user_files(user_id)
    content = files[filename]

    count = content.count(old_string)
    if count == 0:
        return f"Text not found in {filename}. Read the file first to see current content."
    if count > 1:
        return (
            f"Ambiguous match — text appears {count} times in {filename}. "
            "Use a longer old_string for a unique match."
        )

    new_content = content.replace(old_string, new_string, 1)
    await save_user_file(user_id, filename, new_content)
    return f"Updated {filename}."


async def execute_append_memory(user_id: int, note: str) -> str:
    files = await load_user_files(user_id)
    content = files["memory.md"]
    today = date.today().isoformat()
    entry = f"- {today}: {note}"

    if content:
        new_content = content + "\n" + entry
    else:
        new_content = entry

    await save_user_file(user_id, "memory.md", new_content)

    if len(new_content) > MEMORY_SOFT_LIMIT:
        return (
            f"Noted. Warning: memory.md is getting long ({len(new_content)} chars). "
            "Consider asking the user if you should clean it up."
        )
    return "Noted."
