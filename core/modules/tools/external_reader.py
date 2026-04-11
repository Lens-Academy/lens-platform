# core/modules/tools/external_reader.py
"""Isolated tool for fetching and cleaning external URL content for the AI Tutor."""

import logging
import re
import httpx
from typing import Any

logger = logging.getLogger(__name__)

# Safety Limits
FETCH_TIMEOUT = 5.0  # seconds
MAX_CONTENT_CHARS = 10000  # limit to prevent prompt bloat

async def execute_read_url(url: str) -> str:
    """Fetch a URL, strip noise (SVG/Style/Script), and return clean text.
    
    Returns:
        String containing Title, Description, and cleaned Body content.
    """
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            html = response.text
            
            # 1. Extract Metadata
            title_match = re.search(r"<title[^>]*>(.*?)<\/title>", html, re.IGNORECASE | re.DOTALL)
            title = title_match.group(1) if title_match else ""
            
            meta_desc_match = re.search(r"<meta\s+name=[\"']description[\"']\s+content=[\"'](.*?)[\"']", html, re.IGNORECASE | re.DOTALL)
            og_desc_match = re.search(r"<meta\s+property=[\"']og:description[\"']\s+content=[\"'](.*?)[\"']", html, re.IGNORECASE | re.DOTALL)
            description = og_desc_match.group(1) if og_desc_match else (meta_desc_match.group(1) if meta_desc_match else "")

            # 2. Deep Data Harvesting (Specific to AI Chronicle EV array)
            deep_data = []
            ev_match = re.search(r"const\s+EV\s*=\s*(\[.*?\]);", html, re.IGNORECASE | re.DOTALL)
            if ev_match:
                try:
                    # More flexible regex to handle unquoted JS keys like t: and desc:
                    # This captures both titles and descriptions independently
                    content_chunk = ev_match.group(1)
                    # Find all titles (t:"...") and descriptions (desc:"...")
                    # We look for the patterns t:"..." and desc:"..."
                    titles = re.findall(r't:"(.*?)"', content_chunk)
                    descs = re.findall(r'desc:"(.*?)"', content_chunk)
                    
                    # Zip them together (they exist in pairs in the EV array)
                    for t, desc in zip(titles, descs):
                        clean_t = t.encode().decode('unicode_escape') if '\\u' in t else t
                        clean_desc = desc.encode().decode('unicode_escape') if '\\u' in desc else desc
                        deep_data.append(f"• {clean_t}: {clean_desc}")
                except Exception:
                    pass

            # 3. Aggressive Noise Stripping (Premium Context)
            clean_html = re.sub(r"<style[^>]*>.*?<\/style>", " ", html, flags=re.IGNORECASE | re.DOTALL)
            clean_html = re.sub(r"<script[^>]*>.*?<\/script>", " ", clean_html, flags=re.IGNORECASE | re.DOTALL)
            clean_html = re.sub(r"<svg[^>]*>.*?<\/svg>", " ", clean_html, flags=re.IGNORECASE | re.DOTALL)
            clean_html = re.sub(r"<path[^>]*>.*?<\/path>", " ", clean_html, flags=re.IGNORECASE | re.DOTALL)
            
            # 3. Clean up HTML tags and whitespace
            body = re.sub(r"<[^>]*>?", " ", clean_html)
            body = re.sub(r"\s+", " ", body).strip()
            
            # 4. Construct response
            parts = []
            if title: parts.append(f"TITLE: {title}")
            if description: parts.append(f"DESCRIPTION: {description}")
            if deep_data:
                parts.append("TIMELINE DATA (Extracted from Source Code):")
                parts.extend(deep_data)
            if body: parts.append(f"CLEANED BODY: {body[:MAX_CONTENT_CHARS]}")
            
            if not parts:
                return "No readable content found at this URL."
                
            return "\n\n".join(parts)

    except httpx.HTTPStatusError as e:
        logger.error(f"Failed to fetch {url}: {e}")
        return f"Error: The website returned a {e.response.status_code} error."
    except httpx.TimeoutException:
        logger.error(f"Timeout fetching {url}")
        return "Error: The connection timed out while trying to reach the site."
    except Exception as e:
        logger.error(f"Unexpected error fetching {url}: {e}", exc_info=True)
        return f"Error: Unable to fetch the content ({type(e).__name__})."
