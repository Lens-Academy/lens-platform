"""Local tool definitions and execution for course content search and reading."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .content_index import ContentIndex


SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_course_content",
        "description": (
            "Search across all course content and reference materials (articles, videos, text, books) "
            "for relevant excerpts. Use when the student asks about topics that may be covered "
            "elsewhere in the course or in reference books, or when you need to find specific "
            "content to reference."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search terms to find in course content",
                },
            },
            "required": ["query"],
        },
    },
}

READ_TOOL = {
    "type": "function",
    "function": {
        "name": "read_lens",
        "description": (
            "Read the full content of a specific lens (page) or reference chapter. "
            "Use the path format: Course/Module/Lens for course content, or "
            "Source/Chapter for reference materials (e.g. 'IABIED/01 - Chapter 1 - ...'). "
            "Returns all segments with their content."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": (
                        "Full path to the lens: 'Course Title/Module Title/Lens Title'"
                    ),
                },
            },
            "required": ["path"],
        },
    },
}


def get_tool_definitions() -> list[dict]:
    """Return tool definitions in OpenAI function-calling format."""
    return [SEARCH_TOOL, READ_TOOL]


def execute_tool(tool_call, index: ContentIndex) -> str:
    """Execute a local course content tool and return result as string."""
    name = tool_call.function.name
    args = json.loads(tool_call.function.arguments)

    if name == "search_course_content":
        return _execute_search(args, index)
    elif name == "read_lens":
        return _execute_read(args, index)
    else:
        return f"Error: unknown tool '{name}'"


def _execute_search(args: dict, index: ContentIndex) -> str:
    query = args.get("query", "")
    results = index.search(query)
    if not results:
        return f'No results found for "{query}".'
    lines = [f'Found {len(results)} result(s) for "{query}":', ""]
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r.path} ({r.segment_type})")
        lines.append(f'   "{r.snippet}"')
        lines.append("")
    return "\n".join(lines)


def _execute_read(args: dict, index: ContentIndex) -> str:
    path = args.get("path", "")
    content = index.read_lens(path)
    if content is None:
        available = index.list_paths()
        path_lower = path.lower()
        close = [p for p in available if path_lower.split("/")[-1] in p.lower()]
        suggestion = ""
        if close:
            suggestion = "\n\nDid you mean one of these?\n" + "\n".join(
                f"- {p}" for p in close[:3]
            )
        return f'Lens not found: "{path}".{suggestion}'
    return content
