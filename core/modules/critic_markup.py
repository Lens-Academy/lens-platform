# core/modules/critic_markup.py
"""Strip critic markup from text (reject all changes behavior)."""

import re


def strip_critic_markup(text: str) -> str:
    """
    Strip critic markup from text using "reject all changes" behavior.

    Critic markup types and handling:
    - {>>comment<<}     → remove entirely
    - {++addition++}    → remove entirely (reject the addition)
    - {--deletion--}    → keep inner content (reject the deletion)
    - {~~old~>new~~}    → keep old, discard new (reject the substitution)
    - {==highlight==}   → keep inner content, remove markers

    Args:
        text: Text possibly containing critic markup

    Returns:
        Text with all critic markup processed
    """
    # Comments: {>>...<<} → remove entirely
    text = re.sub(r"\{>>.*?<<\}", "", text, flags=re.DOTALL)

    # Additions: {++...++} → remove entirely
    text = re.sub(r"\{\+\+.*?\+\+\}", "", text, flags=re.DOTALL)

    # Deletions: {--...--} → keep inner content
    text = re.sub(r"\{--(.*?)--\}", r"\1", text, flags=re.DOTALL)

    # Substitutions: {~~old~>new~~} → keep old
    text = re.sub(r"\{~~(.*?)~>.*?~~\}", r"\1", text, flags=re.DOTALL)

    # Highlights: {==...==} → keep inner content
    text = re.sub(r"\{==(.*?)==\}", r"\1", text, flags=re.DOTALL)

    return text
