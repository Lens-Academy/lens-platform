"""Test Stampy API streaming directly to measure chunk timing."""
import asyncio
import time
import httpx
import json

STAMPY_API_URL = "https://chat.stampy.ai:8443/chat"

async def test_stream():
    print("Connecting to Stampy API...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            STAMPY_API_URL,
            json={
                "query": "Will we create superintelligence?",
                "sessionId": "test-direct",
                "stream": True,
            },
        ) as response:
            last_time = time.time()
            chunk_count = 0
            current_state = None

            async for line in response.aiter_lines():
                now = time.time()
                gap_ms = (now - last_time) * 1000
                last_time = now

                if not line.startswith("data: "):
                    continue

                try:
                    data = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                state = data.get("state")
                content = data.get("content", "")

                chunk_count += 1

                # Print state transitions clearly
                if state != current_state:
                    print(f"\n=== STATE CHANGE: {current_state} -> {state} ===\n")
                    current_state = state

                if state in ("thinking", "streaming"):
                    content_len = len(content) if content else 0
                    # Mark bursts (gap < 5ms) vs real streams (gap > 5ms)
                    marker = "BURST" if gap_ms < 5 else ""
                    print(f"Chunk #{chunk_count:3d} ({state:9s}): gap={gap_ms:6.0f}ms, len={content_len:3d} {marker}")
                elif state == "citations":
                    print(f"Chunk #{chunk_count:3d} ({state:9s}): gap={gap_ms:6.0f}ms, {len(data.get('citations', []))} citations")

if __name__ == "__main__":
    asyncio.run(test_stream())
