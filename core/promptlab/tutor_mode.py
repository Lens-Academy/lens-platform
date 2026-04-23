"""Prompt Lab 'live tutor mode' — runs the real tutor pipeline without DB.

Reuses the same scenario builder and LLM loop as web_api/routes/module.py,
so a prompt iterated here behaves identically to the production tutor.
The only runtime difference: no database writes, no chat session, and the
facilitator can toggle pieces of the pipeline (tools, course overview,
thinking, effort) and override the tutor base persona.
"""

from typing import AsyncIterator

from core.modules.chat import send_module_message
from core.modules.loader import load_flattened_module
from core.modules.tutor_scenario import ScenarioTurn, build_scenario_turn


async def run_tutor_turn(
    module_slug: str | None = None,
    section_index: int = 0,
    segment_index: int = 0,
    messages: list[dict] | None = None,
    course_slug: str | None = None,
    base_prompt_override: str | None = None,
    enable_tools: bool = True,
    enable_thinking: bool = True,
    effort: str = "low",
    include_course_overview: bool = True,
    model: str | None = None,
    mcp_manager=None,
    content_index=None,
    prebuilt_scenario: ScenarioTurn | None = None,
    instructions_override: str | None = None,
    content_context_override: str | None = None,
    course_overview_override: str | None = None,
    llm_messages_override: list[dict] | None = None,
    system_prompt_override: str | None = None,
) -> AsyncIterator[dict]:
    """Run one tutor turn through the real pipeline, no DB writes.

    Two scenario sources:

    1. **Live module** (default): pass `module_slug`, position, and `messages`;
       `build_scenario_turn` assembles a ScenarioTurn from the live content.
       The `*_override` kwargs skip their respective gather/build steps
       inside `build_scenario_turn` (see its docstring).

    2. **Prebuilt** (`prebuilt_scenario`): caller has already produced a
       ScenarioTurn (e.g. from a fixture) — the build step is skipped
       entirely and the override kwargs for build are ignored.

    `system_prompt_override`, when set, bypasses `_build_system_prompt` inside
    `send_module_message` and is used verbatim as the LLM system prompt. This
    is orthogonal to scenario source: both sources can use it.

    Args:
        module_slug: Module to load when building a scenario. Ignored when
            prebuilt_scenario is given.
        section_index / segment_index: Student's position (live-module mode).
        messages: Conversation so far (live-module mode). If the last entry
            is a user message, it is treated as the new turn's input
            (triggers position-change injection just like the real tutor).
        course_slug: If set with include_course_overview=True, injects the
            course overview into the system prompt.
        base_prompt_override: Replaces DEFAULT_BASE_PROMPT in the tutor's
            system prompt. None uses production default.
        enable_tools: If False, tools are neither loaded nor offered to the
            model (MCP + local course search).
        enable_thinking: Toggles adaptive thinking / chain-of-thought.
        effort: "low" | "medium" | "high" — only used when thinking is on.
        include_course_overview: Toggle overview injection independently of
            course_slug presence.
        model: LiteLLM model id (e.g. "anthropic/claude-opus-4-7"). None
            uses DEFAULT_PROVIDER from env.
        mcp_manager / content_index: From app.state. Required for tools.
        prebuilt_scenario: If given, skip `build_scenario_turn` and use this
            ScenarioTurn directly.
        instructions_override / content_context_override /
            course_overview_override / llm_messages_override: Passed through
            to `build_scenario_turn`; ignored when prebuilt_scenario is set.
        system_prompt_override: Passed through to `send_module_message`.
            Verbatim system prompt; bypasses assembly.

    Yields the same event shape as send_module_message() minus tool_save
    (Prompt Lab has no DB to persist to).
    """
    if prebuilt_scenario is not None:
        scenario = prebuilt_scenario
    else:
        if module_slug is None:
            raise ValueError(
                "run_tutor_turn requires either prebuilt_scenario or module_slug"
            )
        module = load_flattened_module(module_slug)

        user_message = ""
        existing = messages or []
        if existing and existing[-1].get("role") == "user":
            user_message = existing[-1].get("content", "")
            existing = existing[:-1]

        scenario = build_scenario_turn(
            module=module,
            section_index=section_index,
            segment_index=segment_index,
            existing_messages=existing,
            user_message=user_message,
            course_slug=course_slug,
            roleplay_transcript=None,
            include_course_overview=include_course_overview,
            instructions_override=instructions_override,
            content_context_override=content_context_override,
            course_overview_override=course_overview_override,
            llm_messages_override=llm_messages_override,
        )

    try:
        async for event in send_module_message(
            scenario.llm_messages,
            scenario.stage,
            scenario.current_content,
            provider=model,
            course_overview=scenario.course_overview,
            mcp_manager=mcp_manager if enable_tools else None,
            content_index=content_index if enable_tools else None,
            thinking=enable_thinking,
            effort=effort,
            base_prompt=base_prompt_override,
            enable_tools=enable_tools,
            system_prompt_override=system_prompt_override,
        ):
            if event.get("type") == "tool_save":
                continue
            yield event
    except Exception as e:
        yield {"type": "error", "message": str(e)}
        yield {"type": "done"}
