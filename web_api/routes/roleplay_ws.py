"""Unified WebSocket endpoint for roleplay: LLM + optional TTS on one connection.

Protocol:
    Client → Server (first message = init):
        {module_slug, roleplay_id, anonymous_token, [voice], [model],
         [audio_encoding], [speaking_rate]}

    Client → Server (subsequent):
        {message: "..."}           — user turn
        {cancel: true}             — cancel in-progress turn

    Server → Client:
        {type: "session", session_id, messages, completed_at}
        {type: "text", content: "token"}
        {type: "thinking", content: "..."}
        <binary audio bytes>
        {type: "log", tag, msg}
        {type: "done"}
        {type: "error", message: "..."}
"""

import asyncio
import logging
import time
from uuid import UUID

import sentry_sdk
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.database import get_connection
from core.modules import ModuleNotFoundError
from core.modules.chat_sessions import add_chat_message, get_or_create_chat_session
from core.modules.llm import stream_chat
from core.modules.loader import find_roleplay_segment, load_flattened_module
from core.modules.roleplay import build_roleplay_prompt
from core.tts import (
    TTSConfig,
    QueueIterator,
    find_split,
    synthesize as tts_synthesize,
    is_tts_available,
)
from web_api.auth import verify_jwt

logger = logging.getLogger(__name__)

router = APIRouter(tags=["roleplay-ws"])


def parse_tts_config(data: dict) -> TTSConfig | None:
    """Extract TTSConfig from init message, or None if no voice specified."""
    voice = data.get("voice")
    if not voice:
        return None
    return TTSConfig(
        voice_id=voice,
        model_id=data.get("model", "inworld-tts-1.5-mini"),
        audio_encoding=data.get("audio_encoding", "LINEAR16"),
        speaking_rate=data.get("speaking_rate"),
    )


async def _handle_init(ws: WebSocket, data: dict) -> dict | None:
    """Process init message: resolve module, session, auth.

    Returns context dict on success, or None on failure (error already sent).
    """
    module_slug = data.get("module_slug")
    roleplay_id_str = data.get("roleplay_id")

    if not module_slug:
        await ws.send_json({"type": "error", "message": "Missing module_slug"})
        return None

    # Load module
    try:
        module = load_flattened_module(module_slug)
    except ModuleNotFoundError:
        await ws.send_json({"type": "error", "message": "Module not found"})
        return None

    # Resolve auth
    user_id = None
    anonymous_token = None

    session_cookie = ws.cookies.get("session")
    if session_cookie:
        payload = verify_jwt(session_cookie)
        if payload and payload.get("sub"):
            from core.queries.users import get_user_by_discord_id

            async with get_connection() as conn:
                db_user = await get_user_by_discord_id(conn, payload["sub"])
                if db_user:
                    user_id = db_user["user_id"]

    if not user_id:
        token_str = data.get("anonymous_token")
        if token_str:
            try:
                anonymous_token = UUID(token_str)
            except ValueError:
                pass

    if not user_id and not anonymous_token:
        await ws.send_json({"type": "error", "message": "Authentication required"})
        return None

    # Parse roleplay ID
    roleplay_uuid = None
    if roleplay_id_str:
        try:
            roleplay_uuid = UUID(roleplay_id_str)
        except ValueError:
            await ws.send_json({"type": "error", "message": "Invalid roleplay_id"})
            return None

    # Resolve segment data from content cache (single source of truth)
    roleplay_seg = (
        find_roleplay_segment(module, roleplay_id_str) if roleplay_id_str else None
    )
    if not roleplay_seg:
        await ws.send_json({"type": "error", "message": "Roleplay segment not found"})
        return None

    segment_snapshot = {
        "content": roleplay_seg.get("content"),
        "aiInstructions": roleplay_seg.get("aiInstructions", ""),
        "openingMessage": roleplay_seg.get("openingMessage"),
        "assessmentInstructions": roleplay_seg.get("assessmentInstructions"),
    }

    # Get or create session
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=module.content_id,
            roleplay_id=roleplay_uuid,
            segment_snapshot=segment_snapshot,
        )

    session_id = session["session_id"]
    existing_messages = session.get("messages", [])
    completed_at = session.get("completed_at")

    # Send session response
    await ws.send_json(
        {
            "type": "session",
            "session_id": session_id,
            "messages": existing_messages,
            "completed_at": completed_at.isoformat() if completed_at else None,
        }
    )

    # Parse TTS config
    tts_config = parse_tts_config(data)

    return {
        "session_id": session_id,
        "existing_messages": existing_messages,
        "module": module,
        "ai_instructions": roleplay_seg.get("aiInstructions", ""),
        "scenario_content": roleplay_seg.get("content"),
        "opening_message": roleplay_seg.get("openingMessage"),
        "user_id": user_id,
        "anonymous_token": anonymous_token,
        "tts_config": tts_config,
        "completed_at": completed_at,
    }


async def _handle_turn_text_only(
    ws: WebSocket,
    ctx: dict,
    user_message: str,
) -> str:
    """Handle a text-only turn (no TTS). Returns assistant content."""
    session_id = ctx["session_id"]
    existing_messages = ctx["existing_messages"]

    # Save user message
    if user_message:
        async with get_connection() as conn:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="user",
                content=user_message,
            )

    # Build system prompt
    system_prompt = build_roleplay_prompt(
        ai_instructions=ctx["ai_instructions"],
        scenario_content=ctx["scenario_content"],
    )

    # Build LLM message history
    llm_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in existing_messages
        if m["role"] in ("user", "assistant")
    ]
    # Stream LLM response
    assistant_content = ""
    try:
        async for chunk in stream_chat(
            messages=llm_messages,
            system=system_prompt,
            tools=None,
        ):
            if chunk.get("type") == "text":
                content = chunk.get("content", "")
                assistant_content += content
                await ws.send_json({"type": "text", "content": content})
            elif chunk.get("type") == "thinking":
                await ws.send_json(
                    {"type": "thinking", "content": chunk.get("content", "")}
                )
            elif chunk.get("type") == "done":
                pass  # We send our own done after saving
    except Exception as e:
        logger.error("Roleplay LLM error: %s", e)
        sentry_sdk.capture_exception(e)
        await ws.send_json({"type": "error", "message": str(e)})

    # Save assistant response
    if assistant_content:
        async with get_connection() as conn:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="assistant",
                content=assistant_content,
            )

    await ws.send_json({"type": "done"})
    return assistant_content


async def _handle_turn_with_tts(
    ws: WebSocket,
    ctx: dict,
    user_message: str,
) -> str:
    """Handle a turn with TTS: LLM tokens → sentence buffer → TTS → audio.

    Two concurrent tasks sharing a QueueIterator:
    - LLM task: streams tokens, buffers into sentences, pushes to queue
    - TTS task: reads queue, synthesizes, sends binary audio to client
    """
    session_id = ctx["session_id"]
    existing_messages = ctx["existing_messages"]
    tts_config = ctx["tts_config"]

    # Save user message
    if user_message:
        async with get_connection() as conn:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="user",
                content=user_message,
            )

    # Build prompts
    system_prompt = build_roleplay_prompt(
        ai_instructions=ctx["ai_instructions"],
        scenario_content=ctx["scenario_content"],
    )
    llm_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in existing_messages
        if m["role"] in ("user", "assistant")
    ]
    queue_iter = QueueIterator()
    assistant_content = ""
    llm_error = None

    async def llm_task():
        nonlocal assistant_content, llm_error
        buffer = ""
        first_sent = False
        t0 = time.monotonic()

        async def send_sentence(text: str) -> None:
            nonlocal first_sent
            elapsed = time.monotonic() - t0
            preview = text.strip()[:120]
            ellipsis = "..." if len(text.strip()) > 120 else ""
            await ws.send_json(
                {
                    "type": "log",
                    "tag": "TTS",
                    "msg": f"[{elapsed:.1f}s] Sending: {preview}{ellipsis}",
                }
            )
            await queue_iter.put(text)
            first_sent = True

        try:
            async for chunk in stream_chat(
                messages=llm_messages,
                system=system_prompt,
                tools=None,
            ):
                if chunk.get("type") == "text":
                    content = chunk.get("content", "")
                    assistant_content += content
                    await ws.send_json({"type": "text", "content": content})

                    buffer += content
                    while True:
                        split_pos = find_split(buffer, aggressive=not first_sent)
                        if split_pos < 0:
                            break
                        sentence = buffer[:split_pos]
                        buffer = buffer[split_pos:]
                        if sentence.strip():
                            await send_sentence(sentence)

                elif chunk.get("type") == "thinking":
                    await ws.send_json(
                        {"type": "thinking", "content": chunk.get("content", "")}
                    )

            # LLM done — flush remaining buffer
            if buffer.strip():
                await send_sentence(buffer)

        except asyncio.CancelledError:
            if buffer.strip():
                await queue_iter.put(buffer)
            raise
        except Exception as e:
            llm_error = e
            logger.error("Roleplay LLM error in TTS mode: %s", e)
            sentry_sdk.capture_exception(e)
        finally:
            await queue_iter.put(None)  # Signal end-of-stream to TTS

    tts_audio_bytes = 0
    tts_audio_chunks = 0

    async def tts_task():
        nonlocal tts_audio_bytes, tts_audio_chunks
        try:
            if not is_tts_available():
                await ws.send_json(
                    {
                        "type": "log",
                        "tag": "TTS",
                        "msg": "TTS unavailable (no API key), skipping audio",
                    }
                )
                return

            async for audio_chunk in tts_synthesize(queue_iter, tts_config):
                tts_audio_bytes += len(audio_chunk)
                tts_audio_chunks += 1
                await ws.send_bytes(audio_chunk)

            # Report audio stats so frontend can verify delivery
            encoding = tts_config.audio_encoding if tts_config else "MP3"
            sample_rate = tts_config.sample_rate_hz if tts_config else 48000
            if encoding == "LINEAR16":
                duration = tts_audio_bytes / 2 / sample_rate
            else:
                duration = None  # Can't easily compute for MP3
            await ws.send_json(
                {
                    "type": "log",
                    "tag": "TTS",
                    "msg": (
                        f"Audio complete: {tts_audio_chunks} chunks, "
                        f"{tts_audio_bytes} bytes"
                        + (f", {duration:.1f}s" if duration else "")
                    ),
                }
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("TTS synthesis error: %s", e)
            await ws.send_json(
                {
                    "type": "log",
                    "tag": "TTS",
                    "msg": f"TTS error: {e}",
                }
            )

    # Run both concurrently
    llm = asyncio.create_task(llm_task())
    tts = asyncio.create_task(tts_task())

    try:
        await asyncio.gather(llm, tts)
    except Exception:
        # Cancel the other task on failure
        if not llm.done():
            llm.cancel()
        if not tts.done():
            tts.cancel()
        # Wait for cancellation
        for task in [llm, tts]:
            if not task.done():
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    if llm_error:
        await ws.send_json({"type": "error", "message": str(llm_error)})

    # Save assistant response
    if assistant_content:
        async with get_connection() as conn:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="assistant",
                content=assistant_content,
            )

    await ws.send_json(
        {
            "type": "done",
            "audio_bytes": tts_audio_bytes,
            "audio_chunks": tts_audio_chunks,
        }
    )
    return assistant_content


async def _handle_opening_message(
    ws: WebSocket,
    ctx: dict,
) -> str:
    """Handle opening message: save to DB, send as text, optionally TTS."""
    opening = ctx["opening_message"]
    session_id = ctx["session_id"]

    # Save opening message
    async with get_connection() as conn:
        await add_chat_message(
            conn,
            session_id=session_id,
            role="assistant",
            content=opening,
        )

    # Send as text
    await ws.send_json({"type": "text", "content": opening})

    # Optionally synthesize TTS
    tts_config = ctx.get("tts_config")
    if tts_config and is_tts_available():
        try:

            async def _single_iter():
                yield opening

            async for audio_chunk in tts_synthesize(_single_iter(), tts_config):
                await ws.send_bytes(audio_chunk)
        except Exception as e:
            logger.error("TTS error for opening message: %s", e)

    await ws.send_json({"type": "done"})
    return opening


async def _replay_opening_tts(
    ws: WebSocket,
    ctx: dict,
) -> None:
    """Replay TTS for existing session's opening message (no text, no DB save)."""
    opening = ctx["opening_message"]
    tts_config = ctx.get("tts_config")
    if tts_config and is_tts_available():
        try:

            async def _single_iter():
                yield opening

            async for audio_chunk in tts_synthesize(_single_iter(), tts_config):
                await ws.send_bytes(audio_chunk)
        except Exception as e:
            logger.error("TTS replay error for opening message: %s", e)

    await ws.send_json({"type": "done"})


@router.websocket("/ws/chat/roleplay")
async def roleplay_ws(ws: WebSocket) -> None:
    """Unified roleplay WebSocket: LLM + optional TTS."""
    await ws.accept()

    ctx = None
    turn_task: asyncio.Task | None = None
    turn_in_progress = False

    try:
        # First message must be init
        data = await ws.receive_json()
        ctx = await _handle_init(ws, data)
        if ctx is None:
            await ws.close()
            return

        # Main message loop
        while True:
            data = await ws.receive_json()

            # Cancel
            if data.get("cancel"):
                if turn_task and not turn_task.done():
                    turn_task.cancel()
                    try:
                        await turn_task
                    except (asyncio.CancelledError, Exception):
                        pass
                    turn_in_progress = False
                    await ws.send_json({"type": "done"})
                continue

            # Turn guard
            if turn_in_progress:
                await ws.send_json(
                    {
                        "type": "error",
                        "message": "Turn in progress — wait for done or send cancel",
                    }
                )
                continue

            user_message = data.get("message", "")

            # Opening message path: empty message + opening configured
            if not user_message and ctx.get("opening_message"):
                if not ctx["existing_messages"]:
                    # New session: save to DB, stream text + TTS
                    turn_in_progress = True

                    async def _do_opening():
                        nonlocal turn_in_progress
                        try:
                            content = await _handle_opening_message(ws, ctx)
                            ctx["existing_messages"].append(
                                {"role": "assistant", "content": content}
                            )
                        finally:
                            turn_in_progress = False

                    turn_task = asyncio.ensure_future(_do_opening())
                else:
                    # Existing session: replay TTS only (text already in history)
                    turn_in_progress = True

                    async def _do_replay_tts():
                        nonlocal turn_in_progress
                        try:
                            await _replay_opening_tts(ws, ctx)
                        finally:
                            turn_in_progress = False

                    turn_task = asyncio.ensure_future(_do_replay_tts())
                continue

            if not user_message:
                continue

            # Regular turn
            turn_in_progress = True

            async def _do_turn(msg=user_message):
                nonlocal turn_in_progress
                try:
                    # Add user message to tracked history
                    ctx["existing_messages"].append({"role": "user", "content": msg})

                    if ctx["tts_config"]:
                        content = await _handle_turn_with_tts(ws, ctx, msg)
                    else:
                        content = await _handle_turn_text_only(ws, ctx, msg)

                    if content:
                        ctx["existing_messages"].append(
                            {"role": "assistant", "content": content}
                        )
                finally:
                    turn_in_progress = False

            turn_task = asyncio.ensure_future(_do_turn())

    except WebSocketDisconnect:
        logger.info("Roleplay WebSocket client disconnected")
    except Exception:
        logger.exception("Roleplay WebSocket error")
        try:
            await ws.send_json({"type": "error", "message": "Internal server error"})
            await ws.close()
        except Exception:
            pass
    finally:
        if turn_task and not turn_task.done():
            turn_task.cancel()
            try:
                await turn_task
            except (asyncio.CancelledError, Exception):
                pass
