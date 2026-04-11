# core/content/typescript_processor.py
"""TypeScript content processor subprocess wrapper.

Calls the TypeScript CLI via subprocess, piping content through stdin.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class TypeScriptProcessorError(Exception):
    """Raised when TypeScript processing fails."""

    pass


def _get_content_processor_dir() -> Path:
    """Get the path to the content_processor directory."""
    # This file is at core/content/typescript_processor.py
    # content_processor is at repo_root/content_processor
    return Path(__file__).parent.parent.parent / "content_processor"


async def process_content_typescript(files: dict[str, str]) -> dict[str, Any]:
    """Process content files using the TypeScript CLI.

    Args:
        files: Dict mapping file paths to content strings.
               e.g., {"modules/intro.md": "---\nslug: intro\n...", ...}

    Returns:
        ProcessResult dict with keys: modules, courses, errors

    Raises:
        TypeScriptProcessorError: If subprocess fails or returns invalid JSON.
    """
    content_processor_dir = _get_content_processor_dir()

    # Serialize files to JSON
    input_json = json.dumps(files)

    # Build command
    # Use npx tsx to run TypeScript directly
    cmd = ["npx", "tsx", "src/cli.ts", "--stdin"]

    logger.info(f"Running TypeScript processor with {len(files)} files")

    try:
        # Run subprocess
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(content_processor_dir),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate(input=input_json.encode("utf-8"))

        # Log stderr as warnings (TypeScript may log there)
        if stderr:
            stderr_text = stderr.decode("utf-8").strip()
            if stderr_text:
                logger.warning(f"TypeScript stderr: {stderr_text}")

        # Check exit code
        if process.returncode != 0:
            stderr_text = stderr.decode("utf-8") if stderr else "No stderr"
            raise TypeScriptProcessorError(
                f"TypeScript CLI exited with code {process.returncode}: {stderr_text}"
            )

        # Parse output
        stdout_text = stdout.decode("utf-8")
        try:
            result = json.loads(stdout_text)
        except json.JSONDecodeError as e:
            raise TypeScriptProcessorError(f"TypeScript CLI returned invalid JSON: {e}")

        logger.info(
            f"TypeScript processed {len(result.get('modules', []))} modules, "
            f"{len(result.get('errors', []))} errors"
        )

        return result

    except FileNotFoundError:
        raise TypeScriptProcessorError("npx not found. Is Node.js installed?")
    except Exception as e:
        if isinstance(e, TypeScriptProcessorError):
            raise
        raise TypeScriptProcessorError(f"Subprocess failed: {e}")
