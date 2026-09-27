"""This file contains the prompts for the agent."""

import os
from datetime import datetime
from typing import Optional

from app.core.config import settings

_PROMPTS_DIR = os.path.dirname(__file__)

# Always pass encoding="utf-8": without it Python falls back to the platform
# locale (GBK/cp936 on Windows), which blows up on any non-ASCII character such
# as the arrows used in the fact-extraction few-shot examples.
with open(os.path.join(_PROMPTS_DIR, "system.md"), "r", encoding="utf-8") as _f:
    _SYSTEM_PROMPT_TEMPLATE = _f.read()

with open(os.path.join(_PROMPTS_DIR, "session_title.md"), "r", encoding="utf-8") as _f:
    SESSION_TITLE_PROMPT = _f.read()

# Read as-is: never run .format() over this one, the JSON contract in the prompt
# ({"facts": [...]}) would be interpreted as format placeholders.
with open(os.path.join(_PROMPTS_DIR, "fact_extraction.md"), "r", encoding="utf-8") as _f:
    FACT_EXTRACTION_PROMPT = _f.read()

# Only the strategy header: mem0 appends its own memory block, JSON schema and
# operation rules after this text, so it must not restate the output contract.
with open(os.path.join(_PROMPTS_DIR, "memory_update.md"), "r", encoding="utf-8") as _f:
    UPDATE_MEMORY_PROMPT = _f.read()


def load_system_prompt(username: Optional[str] = None, **kwargs):
    """Load the system prompt from the cached template."""
    user_context = f"# User\nYou are talking to {username}.\n" if username else ""
    return _SYSTEM_PROMPT_TEMPLATE.format(
        agent_name=settings.PROJECT_NAME + " Agent",
        current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        user_context=user_context,
        **kwargs,
    )
