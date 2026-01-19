#!/usr/bin/env python3
"""
Article extraction pipeline using Jina Reader API with local fallbacks.

Primary extractor: Jina Reader API (r.jina.ai) - free tier, excellent quality
Fallbacks: trafilatura, readability-lxml, pymupdf (for PDFs)
Metadata: trafilatura (for author/date when Jina doesn't provide them)

Modes:
1. Simple mode (default): Jina API + light cleanup
2. Dual mode (--dual): Save both extractions for skill-based selection
3. Local-only mode (--local): Skip API, use only local extractors

Usage:
    # Simple extraction (uses Jina API)
    python extract_pipeline.py "URL" output.md

    # Local-only extraction (no API)
    python extract_pipeline.py --local "URL" output.md

    # Batch processing
    python extract_pipeline.py --batch urls.txt --output-dir ./articles/
"""

import argparse
import asyncio
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from lxml import html as lxml_html

# Local extractors
try:
    import trafilatura
    from trafilatura import bare_extraction

    HAS_TRAFILATURA = True
except ImportError:
    HAS_TRAFILATURA = False

try:
    from readability import Document

    HAS_READABILITY = True
except ImportError:
    HAS_READABILITY = False

try:
    import pymupdf

    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False


# === Data Classes ===


@dataclass
class Metadata:
    """Article metadata."""

    title: Optional[str] = None
    author: Optional[str] = None
    date: Optional[str] = None
    url: str = ""


@dataclass
class ExtractionResult:
    """Result from the extraction pipeline."""

    url: str
    success: bool = False
    content: str = ""
    metadata: Metadata = field(default_factory=Metadata)
    method: str = ""
    error: Optional[str] = None
    # Paths to intermediate files (for dual mode)
    traf_path: Optional[Path] = None
    read_path: Optional[Path] = None


# === Fetching ===


async def fetch_html(url: str, timeout: int = 30) -> tuple[str, Optional[str]]:
    """Fetch HTML from URL. Returns (html, error)."""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            r = await client.get(url, timeout=timeout, headers=headers)
            r.raise_for_status()
            return r.text, None
    except httpx.TimeoutException:
        return "", "timeout"
    except httpx.HTTPStatusError as e:
        return "", f"http_{e.response.status_code}"
    except Exception as e:
        return "", str(e)[:50]


async def fetch_pdf_bytes(url: str, timeout: int = 60) -> tuple[bytes, Optional[str]]:
    """Fetch PDF bytes from URL. Returns (bytes, error)."""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.get(url, timeout=timeout)
            r.raise_for_status()
            return r.content, None
    except Exception as e:
        return b"", str(e)[:50]


# === Jina Reader API ===

# Site-specific CSS selectors for cleaner extraction
# Only add selectors for sites where Jina's default misses content
SITE_SELECTORS = {
    "lesswrong.com": "article, .PostsPage-postContent, .posts-page-content",
    "alignmentforum.org": "article, .PostsPage-postContent",
    "wikipedia.org": "#mw-content-text, .mw-parser-output",
}


def get_jina_selector(url: str) -> str | None:
    """Get site-specific CSS selector for Jina API."""
    domain = urlparse(url).netloc.lower()
    for site, selector in SITE_SELECTORS.items():
        if site in domain:
            return selector
    return None


async def extract_jina(url: str, timeout: int = 30) -> tuple[str | None, Metadata]:
    """Extract article using Jina Reader API (r.jina.ai).

    Returns (markdown_content, metadata).
    Free tier: 10M tokens, 500 RPM.
    """
    jina_url = f"https://r.jina.ai/{url}"
    headers = {"Accept": "text/plain"}

    # Add site-specific selector if available
    selector = get_jina_selector(url)
    if selector:
        headers["X-Target-Selector"] = selector

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.get(jina_url, timeout=timeout, headers=headers)
            r.raise_for_status()
            response_text = r.text
    except Exception:
        return None, Metadata()

    # Parse Jina response format:
    # Title: ...
    # URL Source: ...
    # Published Time: ... (optional)
    # Markdown Content:
    # ...
    metadata = Metadata(url=url)
    content = ""

    lines = response_text.split("\n")
    in_content = False
    content_lines = []

    for line in lines:
        if in_content:
            content_lines.append(line)
        elif line.startswith("Title:"):
            metadata.title = line[6:].strip()
        elif line.startswith("Published Time:"):
            # Extract date from ISO format
            date_str = line[15:].strip()
            if date_str and "T" in date_str:
                metadata.date = date_str.split("T")[0]
        elif line.startswith("Markdown Content:"):
            in_content = True

    if content_lines:
        content = "\n".join(content_lines).strip()

    return content if content else None, metadata


# === Local Extractors ===


def extract_trafilatura(html: str) -> tuple[str | None, Metadata]:
    """Extract using trafilatura. Returns (content, metadata)."""
    if not HAS_TRAFILATURA:
        return None, Metadata()

    # Extract metadata using bare_extraction with metadata flag
    doc = bare_extraction(html, with_metadata=True)
    if doc:
        # Convert to dict to reliably access all metadata fields
        doc_dict = (
            doc
            if isinstance(doc, dict)
            else (doc.as_dict() if hasattr(doc, "as_dict") else {})
        )
        metadata = Metadata(
            title=doc_dict.get("title"),
            author=doc_dict.get("author"),
            date=doc_dict.get("date"),
        )
    else:
        metadata = Metadata()

    # Extract text only - links and images will be injected separately
    # This avoids trafilatura's buggy link/image handling
    content = trafilatura.extract(
        html,
        output_format="markdown",
        include_formatting=True,
        include_links=False,
        include_images=False,
    )

    return content, metadata


# === Link and Image Injection ===


def inject_links(content: str, html: str) -> str:
    """Inject links from HTML back into markdown content.

    Strategy: For each <a> tag, capture link text + surrounding context,
    then find that pattern in markdown and wrap the link text with [text](href).
    """
    if not content:
        return content

    try:
        tree = lxml_html.fromstring(html)
    except Exception:
        return content

    # Collect links with context: (before_context, link_text, after_context, href)
    links_with_context = []

    for a in tree.iter("a"):
        href = a.get("href", "")
        if not href:
            continue

        link_text = a.text_content().strip()
        if not link_text or len(link_text) < 2:
            continue

        # Skip anchor-only links
        if href.startswith("#"):
            continue

        # Get surrounding text for context
        # Walk up to find parent with substantial text
        parent = a.getparent()
        if parent is not None:
            parent_text = parent.text_content()

            # Find position of link text in parent
            pos = parent_text.find(link_text)
            if pos >= 0:
                before = parent_text[max(0, pos - 30) : pos].strip()
                after = parent_text[
                    pos + len(link_text) : pos + len(link_text) + 30
                ].strip()
                links_with_context.append((before, link_text, after, href))

    # Sort by link text length (longest first) to avoid partial replacements
    links_with_context.sort(key=lambda x: -len(x[1]))

    result = content
    replaced = set()  # Track what we've replaced to avoid duplicates

    for before, link_text, after, href in links_with_context:
        # Skip if we already created this exact markdown link
        md_link = f"[{link_text}]({href})"
        if md_link in replaced:
            continue

        # Skip if this link text is already a markdown link
        if f"[{link_text}](" in result:
            continue

        # Try to find with context first (more precise)
        if before and after:
            # Escape special regex chars in the text portions
            before_esc = re.escape(before[-15:]) if len(before) > 15 else re.escape(before)
            after_esc = re.escape(after[:15]) if len(after) > 15 else re.escape(after)
            link_esc = re.escape(link_text)

            pattern = f"({before_esc}\\s*)({link_esc})(\\s*{after_esc})"
            match = re.search(pattern, result)
            if match:
                replacement = f"{match.group(1)}[{link_text}]({href}){match.group(3)}"
                result = result[: match.start()] + replacement + result[match.end() :]
                replaced.add(md_link)
                continue

        # Fallback: just find and replace first occurrence
        # But only if the link text is reasonably unique (> 5 chars)
        if len(link_text) > 5 and link_text in result:
            result = result.replace(link_text, f"[{link_text}]({href})", 1)
            replaced.add(md_link)

    return result


def inject_images(content: str, html: str) -> str:
    """Inject images from HTML back into markdown content.

    Strategy (from legacy): Walk HTML, track last paragraph as anchor,
    for each image record (anchor, image_md), then inject after anchor in markdown.
    """
    if not content:
        return content

    try:
        tree = lxml_html.fromstring(html)
    except Exception:
        return content

    # Find content container
    content_selectors = [
        './/div[contains(@class,"entry-content")]',
        './/article//div[contains(@class,"content")]',
        ".//article",
        './/div[contains(@class,"post-content")]',
        './/div[contains(@class,"article-content")]',
        ".//main",
    ]

    content_div = None
    for sel in content_selectors:
        matches = tree.xpath(sel)
        if matches:
            content_div = matches[0]
            break

    if content_div is None:
        # Try the whole body
        bodies = tree.xpath(".//body")
        if bodies:
            content_div = bodies[0]
        else:
            return content

    # Collect (anchor_text, image_md) pairs
    image_insertions = []
    last_text = ""

    for elem in content_div.iter():
        if elem.tag == "p":
            text = elem.text_content().strip()
            if text and len(text) > 20:
                last_text = text
        elif elem.tag == "img":
            src = elem.get("src", "")
            alt = elem.get("alt", "") or ""

            # Filter: must have image extension
            if not any(
                ext in src.lower()
                for ext in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]
            ):
                continue

            # Skip tiny images (likely icons/tracking pixels)
            width = elem.get("width", "999")
            height = elem.get("height", "999")
            try:
                if int(width) < 50 or int(height) < 50:
                    continue
            except (ValueError, TypeError):
                pass

            # Skip common non-content images
            if any(
                skip in src.lower()
                for skip in [
                    "facebook",
                    "twitter",
                    "pinterest",
                    "share",
                    "logo",
                    "icon",
                    "avatar",
                ]
            ):
                continue

            image_md = f"\n\n![{alt}]({src})\n\n"
            if last_text:
                image_insertions.append((last_text, image_md))

    # Inject images into markdown
    result = content
    inserted_images = set()

    for text_marker, image_md in image_insertions:
        # Skip duplicates
        if image_md in inserted_images:
            continue

        # Use first 40 chars of marker for matching
        marker_clean = text_marker[:40]
        marker_escaped = re.escape(marker_clean)

        # Find the marker and insert image after the line
        pattern = rf"({marker_escaped}[^\n]*\n)"
        match = re.search(pattern, result)

        if match:
            insert_pos = match.end()
            result = result[:insert_pos] + image_md + result[insert_pos:]
            inserted_images.add(image_md)

    return result


def extract_readability(html: str) -> tuple[str | None, Metadata]:
    """Extract using readability-lxml. Returns (content, metadata)."""
    if not HAS_READABILITY:
        return None, Metadata()

    try:
        doc = Document(html)
        title = doc.title()
        html_content = doc.summary()
        content = html_to_markdown(html_content)
        metadata = Metadata(title=title)
        return content, metadata
    except Exception:
        return None, Metadata()


def html_to_markdown(html: str) -> str:
    """Convert HTML to markdown (simple conversion)."""
    content = html

    # Headers
    content = re.sub(r"<h1[^>]*>(.*?)</h1>", r"# \1\n\n", content, flags=re.DOTALL)
    content = re.sub(r"<h2[^>]*>(.*?)</h2>", r"## \1\n\n", content, flags=re.DOTALL)
    content = re.sub(r"<h3[^>]*>(.*?)</h3>", r"### \1\n\n", content, flags=re.DOTALL)
    content = re.sub(r"<h4[^>]*>(.*?)</h4>", r"#### \1\n\n", content, flags=re.DOTALL)

    # Paragraphs and breaks
    content = re.sub(r"<p[^>]*>(.*?)</p>", r"\1\n\n", content, flags=re.DOTALL)
    content = re.sub(r"<br\s*/?>", "\n", content)

    # Formatting
    content = re.sub(r"<strong>(.*?)</strong>", r"**\1**", content, flags=re.DOTALL)
    content = re.sub(r"<b>(.*?)</b>", r"**\1**", content, flags=re.DOTALL)
    content = re.sub(r"<em>(.*?)</em>", r"*\1*", content, flags=re.DOTALL)
    content = re.sub(r"<i>(.*?)</i>", r"*\1*", content, flags=re.DOTALL)

    # Links and images
    content = re.sub(
        r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', r"[\2](\1)", content, flags=re.DOTALL
    )
    content = re.sub(
        r'<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*/?\s*>',
        r"![\2](\1)\n\n",
        content,
    )
    content = re.sub(
        r'<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*/?\s*>',
        r"![\1](\2)\n\n",
        content,
    )
    content = re.sub(r'<img[^>]*src="([^"]*)"[^>]*/?\s*>', r"![](\1)\n\n", content)

    # Lists
    content = re.sub(r"<li[^>]*>(.*?)</li>", r"- \1\n", content, flags=re.DOTALL)
    content = re.sub(r"</?[uo]l[^>]*>", "", content)

    # Blockquotes
    content = re.sub(
        r"<blockquote[^>]*>(.*?)</blockquote>",
        lambda m: "\n".join("> " + line for line in m.group(1).strip().split("\n"))
        + "\n\n",
        content,
        flags=re.DOTALL,
    )

    # Strip remaining tags
    content = re.sub(r"<[^>]+>", "", content)

    # Clean up whitespace
    content = re.sub(r"\n{3,}", "\n\n", content)
    content = "\n".join(line.rstrip() for line in content.split("\n"))

    return content.strip()


def extract_pdf(pdf_bytes: bytes) -> tuple[str | None, Metadata]:
    """Extract text from PDF using PyMuPDF. Returns (content, metadata)."""
    if not HAS_PYMUPDF:
        return None, Metadata()

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        pages = []
        for page in doc:
            text = page.get_text()
            if text.strip():
                pages.append(text.strip())

        content = "\n\n---\n\n".join(pages)

        meta = doc.metadata or {}
        metadata = Metadata(
            title=meta.get("title"),
            author=meta.get("author"),
        )

        doc.close()
        return content, metadata
    except Exception:
        return None, Metadata()


# === API Extractors (Fallback) ===


async def extract_jina(url: str) -> tuple[str | None, Metadata]:
    """Extract using Jina Reader API (free tier)."""
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(f"https://r.jina.ai/{url}")
            if r.status_code != 200 or len(r.text) < 200:
                return None, Metadata()

            content = r.text
            title = None
            for line in content.split("\n")[:10]:
                if line.startswith("Title:"):
                    title = line[6:].strip()
                    break

            return content, Metadata(title=title)
    except Exception:
        return None, Metadata()


async def extract_api_fallback(url: str) -> tuple[str | None, Metadata]:
    """Try API extractors as fallback."""
    content, metadata = await extract_jina(url)
    if content:
        return content, metadata
    return None, Metadata()


# === Cleanup ===


def light_cleanup(content: str, title: str | None = None) -> str:
    """Non-LLM cleanup for basic formatting issues."""
    result = content

    # Normalize smart quotes to ASCII (using Unicode escapes for clarity)
    result = result.replace("\u2018", "'").replace("\u2019", "'")  # Smart single quotes
    result = result.replace("\u201c", '"').replace("\u201d", '"')  # Smart double quotes
    result = result.replace("\u2013", "-").replace("\u2014", "-")  # En/em dashes

    # Remove duplicate H1 title if it matches frontmatter title
    if title:
        # Normalize for comparison: remove quotes, markdown links, site suffixes
        def normalize(s):
            # Remove markdown links but keep text: [text](url) -> text
            s = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', s)
            # Remove quotes and extra whitespace
            s = re.sub(r'["\']', '', s)
            # Remove common suffixes like "- Wikipedia", "- LessWrong"
            s = re.sub(r'\s*-\s*(Wikipedia|LessWrong|Medium)$', '', s, flags=re.I)
            return s.strip().lower()

        title_norm = normalize(title)
        # Check if content starts with H1 that matches title
        h1_match = re.match(r"^#\s+(.+?)(\n|$)", result)
        if h1_match:
            h1_norm = normalize(h1_match.group(1))
            # Remove if H1 matches or is substring of title (at least 10 chars overlap)
            if (h1_norm == title_norm or
                (len(title_norm) >= 10 and title_norm in h1_norm) or
                (len(h1_norm) >= 10 and h1_norm in title_norm)):
                result = result[h1_match.end():].lstrip()

    # Fix spacing around asterisks
    result = re.sub(r"\*\s+([^*]+)\s+\*", r"*\1*", result)
    result = re.sub(r"\*\*\s+([^*]+)\s+\*\*", r"**\1**", result)

    # Collapse excessive blank lines
    result = re.sub(r"\n{3,}", "\n\n", result)

    # Strip trailing whitespace
    result = "\n".join(line.rstrip() for line in result.split("\n"))

    return result


# === Frontmatter ===


def build_frontmatter(metadata: Metadata) -> str:
    """Build YAML frontmatter."""
    lines = ["---"]

    # Escape quotes in title for valid YAML
    title = metadata.title or "Untitled"
    # Replace smart quotes with ASCII (using Unicode escapes)
    title = title.replace("\u2018", "'").replace("\u2019", "'")
    title = title.replace("\u201c", '"').replace("\u201d", '"')
    # Escape double quotes by doubling them, or use single quotes if title has doubles
    if '"' in title:
        # Use single-quoted YAML string (escape single quotes by doubling)
        title_escaped = title.replace("'", "''")
        lines.append(f"title: '{title_escaped}'")
    else:
        lines.append(f'title: "{title}"')

    lines.append(f"author: {metadata.author or 'Unknown'}")
    if metadata.date:
        lines.append(f"date: {metadata.date}")
    lines.append(f"source_url: {metadata.url}")
    lines.append("---")
    lines.append("")
    return "\n".join(lines) + "\n"


def author_slug(author: str | None) -> str:
    """Convert author name to slug (lastname or org name)."""
    if not author:
        return "unknown"

    # Clean up author string
    author = author.strip()

    # Handle organization names (no spaces or already short)
    if " " not in author or len(author) <= 15:
        return re.sub(r"[^a-zA-Z0-9]", "-", author.lower()).strip("-")

    # Extract last name (last word)
    parts = author.split()
    lastname = parts[-1]

    # Clean and return
    return re.sub(r"[^a-zA-Z0-9]", "-", lastname.lower()).strip("-")


# === Main Pipeline ===


def url_to_slug(url: str) -> str:
    """Convert URL to a filename-safe slug."""
    parsed = urlparse(url)
    path_parts = parsed.path.strip("/").split("/")
    if path_parts and path_parts[-1]:
        name = path_parts[-1]
        name = re.sub(r"\.(html?|php|aspx?|pdf)$", "", name, flags=re.IGNORECASE)
    else:
        name = parsed.netloc.replace(".", "-")

    name = re.sub(r"[^a-zA-Z0-9-]", "-", name)
    name = re.sub(r"-+", "-", name).strip("-")[:50]
    return name


def generate_filename(metadata: Metadata, url: str) -> str:
    """Generate filename as {author}-{slug}.md"""
    author_part = author_slug(metadata.author)
    url_part = url_to_slug(url)

    # Avoid duplication if author is already in URL slug
    if author_part and author_part in url_part.lower():
        return f"{url_part}.md"

    return f"{author_part}-{url_part}.md"


async def process_url(
    url: str,
    output_path: Optional[Path] = None,
    dual_mode: bool = False,
    work_dir: Optional[Path] = None,
    verbose: bool = False,
    local_only: bool = False,
) -> ExtractionResult:
    """
    Extract article from URL.

    Args:
        url: URL to extract
        output_path: Path to save final output (simple mode)
        dual_mode: If True, save both extractions for skill-based selection
        work_dir: Directory for intermediate files (dual mode)
        verbose: Print progress
        local_only: If True, skip Jina API and use only local extractors

    Returns:
        ExtractionResult with content and metadata
    """
    result = ExtractionResult(url=url)
    result.metadata.url = url

    is_pdf = url.lower().endswith(".pdf")
    slug = url_to_slug(url)

    if verbose:
        print("  Fetching...", end=" ", flush=True)

    # === PDF Handling ===
    if is_pdf:
        pdf_bytes, error = await fetch_pdf_bytes(url)
        if error:
            result.error = f"fetch_error: {error}"
            if verbose:
                print(f"FAILED ({error})")
            return result

        content, metadata = extract_pdf(pdf_bytes)
        result.method = "pymupdf"
        result.metadata = metadata
        result.metadata.url = url

        if verbose:
            print(f"PDF extracted ({len(content.split()) if content else 0} words)")

        if content:
            result.success = True
            result.content = content

            if output_path:
                frontmatter = build_frontmatter(result.metadata)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(frontmatter + content, encoding="utf-8")
                if verbose:
                    print(f"  Saved to {output_path}")

        return result

    # === Try Jina API first (unless local_only or dual_mode) ===
    if not local_only and not dual_mode:
        if verbose:
            print("trying Jina API...", end=" ", flush=True)

        jina_content, jina_meta = await extract_jina(url)

        # Check if Jina result looks good
        jina_ok = (
            jina_content
            and len(jina_content) > 200
            and jina_meta.title
            and len(jina_meta.title) > 5
            and not jina_meta.title.isdigit()
        )

        if jina_ok:
            if verbose:
                print(f"OK ({len(jina_content.split())} words)", end="", flush=True)

            # Fetch HTML just for metadata (author/date) since Jina doesn't provide them
            html, _ = await fetch_html(url)
            if html:
                traf_content, traf_meta = extract_trafilatura(html)
                # Use trafilatura metadata for author/date
                jina_meta.author = traf_meta.author
                if not jina_meta.date:
                    jina_meta.date = traf_meta.date
                if verbose and traf_meta.author:
                    print(f" (author: {traf_meta.author})", end="", flush=True)

            if verbose:
                print()

            result.metadata = jina_meta
            result.metadata.url = url
            result.method = "jina"
            content = light_cleanup(jina_content, result.metadata.title)
            result.success = True
            result.content = content

            if output_path:
                frontmatter = build_frontmatter(result.metadata)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(frontmatter + content, encoding="utf-8")
                if verbose:
                    print(f"  Saved to {output_path}")

            return result

        if verbose:
            print("poor result, trying local...", end=" ", flush=True)

    # === Fetch HTML for local extraction ===
    html, error = await fetch_html(url)

    if error:
        if verbose:
            print(f"fetch failed ({error})")

        # Try Jina as fallback if we haven't already
        if local_only:
            result.error = f"fetch_error: {error}"
            return result

        if verbose:
            print("  Trying Jina API as fallback...", end=" ", flush=True)

        content, metadata = await extract_jina(url)
        if content:
            result.method = "jina_fallback"
            result.metadata = metadata
            result.metadata.url = url
            result.success = True
            result.content = light_cleanup(content, metadata.title)
            if verbose:
                print(f"OK ({len(content.split())} words)")

            if output_path:
                frontmatter = build_frontmatter(result.metadata)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(frontmatter + result.content, encoding="utf-8")
        else:
            result.error = f"all_methods_failed (fetch: {error})"
            if verbose:
                print("FAILED")

        return result

    # === Local Extraction ===
    if verbose:
        print("extracting locally...", end=" ", flush=True)

    traf_content, traf_meta = extract_trafilatura(html)
    read_content, read_meta = extract_readability(html)

    # Merge metadata
    result.metadata = Metadata(
        title=traf_meta.title or read_meta.title,
        author=traf_meta.author or read_meta.author,
        date=traf_meta.date or read_meta.date,
        url=url,
    )

    if verbose:
        traf_words = len(traf_content.split()) if traf_content else 0
        read_words = len(read_content.split()) if read_content else 0
        print(f"trafilatura={traf_words}w, readability={read_words}w")

    # === Dual Mode: Save both for skill-based selection ===
    if dual_mode:
        if not work_dir:
            work_dir = Path("/tmp/article_extractions")

        work_dir.mkdir(parents=True, exist_ok=True)
        frontmatter = build_frontmatter(result.metadata)

        # Generate base filename from author + slug
        base_name = generate_filename(result.metadata, url).replace(".md", "")

        if traf_content:
            # Apply injection to trafilatura output
            traf_with_injection = inject_links(traf_content, html)
            traf_with_injection = inject_images(traf_with_injection, html)
            traf_path = work_dir / f"{base_name}_trafilatura.md"
            traf_path.write_text(frontmatter + traf_with_injection, encoding="utf-8")
            result.traf_path = traf_path

        if read_content:
            read_path = work_dir / f"{base_name}_readability.md"
            read_path.write_text(frontmatter + read_content, encoding="utf-8")
            result.read_path = read_path

        result.success = True
        result.method = "dual"
        result.content = traf_content or read_content or ""

        if verbose:
            print(f"  Saved extractions to {work_dir}/")
            if result.traf_path:
                print(f"    - {result.traf_path.name}")
            if result.read_path:
                print(f"    - {result.read_path.name}")

        return result

    # === Simple Mode: Choose best extractor ===
    # LessWrong: trafilatura often picks up wrong title/content, prefer readability
    is_lesswrong = "lesswrong.com" in url.lower()

    # Check if trafilatura title looks suspicious
    traf_title = traf_meta.title or ""
    suspicious_title = (
        traf_title.isdigit()  # Just a number (e.g., "167")
        or "fundrais" in traf_title.lower()  # Fundraising banner
        or len(traf_title) < 5  # Too short
        or traf_title.upper() == traf_title  # ALL CAPS
    )

    # Choose extractor
    if is_lesswrong and read_content:
        # LessWrong: prefer readability
        result.metadata.title = read_meta.title  # Use readability's title
        content = light_cleanup(read_content, result.metadata.title)
        result.method = "readability"
    elif suspicious_title and read_content:
        # Suspicious title: fall back to readability
        result.metadata.title = read_meta.title
        content = light_cleanup(read_content, result.metadata.title)
        result.method = "readability"
    elif traf_content:
        # Default: use trafilatura with injection
        content = inject_links(traf_content, html)
        content = inject_images(content, html)
        content = light_cleanup(content, result.metadata.title)
        result.method = "trafilatura"
    elif read_content:
        # Readability fallback
        content = light_cleanup(read_content, result.metadata.title)
        result.method = "readability"
    else:
        # Both failed, try API
        if verbose:
            print("  Local extraction failed, trying API...", end=" ", flush=True)
        content, metadata = await extract_api_fallback(url)
        if content:
            result.method = "api_fallback"
            result.metadata = metadata
            result.metadata.url = url
        else:
            result.error = "all_methods_failed"
            if verbose:
                print("FAILED")
            return result

    result.success = True
    result.content = content

    if output_path:
        frontmatter = build_frontmatter(result.metadata)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(frontmatter + content, encoding="utf-8")
        if verbose:
            print(f"  Saved to {output_path}")

    return result


# === Batch Processing ===


def parse_urls_file(filepath: Path) -> list[str]:
    """Parse URLs file. Returns list of URLs."""
    urls = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            parts = [p.strip() for p in line.split("|")]
            url = parts[0]

            if not url.startswith("http"):
                continue

            urls.append(url)

    return urls


async def process_batch(
    urls: list[str],
    output_dir: Path,
    dual_mode: bool = False,
    work_dir: Optional[Path] = None,
    verbose: bool = False,
    local_only: bool = False,
) -> list[ExtractionResult]:
    """Process multiple URLs."""
    results = []

    for i, url in enumerate(urls, 1):
        print(f"[{i}/{len(urls)}] {url[:60]}...")

        # First extract to get metadata
        result = await process_url(
            url,
            output_path=None,  # Don't save yet
            dual_mode=dual_mode,
            work_dir=work_dir,
            verbose=verbose,
            local_only=local_only,
        )

        # Save with proper filename if not dual mode
        if result.success and not dual_mode:
            filename = generate_filename(result.metadata, url)
            output_path = output_dir / filename
            frontmatter = build_frontmatter(result.metadata)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(frontmatter + result.content, encoding="utf-8")
            if verbose:
                print(f"  Saved to {output_path}")

        results.append(result)

        if not result.success:
            print(f"  ERROR: {result.error}")

    return results


def print_summary(results: list[ExtractionResult], dual_mode: bool = False):
    """Print batch processing summary."""
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    success = sum(1 for r in results if r.success)
    failed = len(results) - success

    print(f"Total: {len(results)}")
    print(f"Success: {success}")
    print(f"Failed: {failed}")

    if failed:
        print("\nFailed URLs:")
        for r in results:
            if not r.success:
                print(f"  - {r.url}: {r.error}")

    # Method breakdown
    methods = {}
    for r in results:
        if r.success:
            methods[r.method] = methods.get(r.method, 0) + 1

    if methods:
        print("\nExtraction methods used:")
        for method, count in sorted(methods.items(), key=lambda x: -x[1]):
            print(f"  {method}: {count}")

    if dual_mode:
        print("\n" + "=" * 60)
        print("NEXT STEPS (for LLM-based selection)")
        print("=" * 60)
        print("""
For each article, ask Claude to:

1. SELECT the better extraction:
   "Compare extractions at {traf_path} and {read_path}
    using the select-extraction skill"

2. CLEANUP the selected extraction:
   "Clean up the article at {selected_path}
    using the cleanup-extraction skill,
    save to articles/{filename}.md"

Or if MERGE is needed:
   "Merge extractions at {traf_path} and {read_path}
    using the merge-extractions skill,
    save to articles/{filename}.md"
""")


# === CLI ===


def main():
    parser = argparse.ArgumentParser(
        description="Extract articles with optional skill-based LLM selection",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Positional args for single URL mode
    parser.add_argument("url", nargs="?", help="URL to extract")
    parser.add_argument("output", nargs="?", help="Output file path (simple mode)")

    # Batch mode
    parser.add_argument("--batch", "-b", type=Path, help="File with URLs to process")
    parser.add_argument(
        "--output-dir",
        "-o",
        type=Path,
        default=Path("."),
        help="Output directory for batch mode",
    )

    # Dual mode
    parser.add_argument(
        "--dual",
        "-d",
        action="store_true",
        help="Save both extractions for skill-based selection",
    )
    parser.add_argument(
        "--work-dir",
        "-w",
        type=Path,
        help="Directory for intermediate files (default: /tmp/article_extractions)",
    )

    # Options
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Show detailed progress"
    )
    parser.add_argument(
        "--local",
        "-l",
        action="store_true",
        help="Skip Jina API, use only local extractors (trafilatura/readability)",
    )

    args = parser.parse_args()

    # Check dependencies
    if args.verbose:
        print("Dependencies:")
        print(f"  trafilatura: {'OK' if HAS_TRAFILATURA else 'MISSING'}")
        print(f"  readability: {'OK' if HAS_READABILITY else 'MISSING'}")
        print(f"  pymupdf: {'OK' if HAS_PYMUPDF else 'MISSING'}")
        print()

    if args.batch:
        # Batch mode
        urls = parse_urls_file(args.batch)
        print(f"Processing {len(urls)} URLs...")

        results = asyncio.run(
            process_batch(
                urls,
                args.output_dir,
                dual_mode=args.dual,
                work_dir=args.work_dir,
                verbose=args.verbose,
                local_only=args.local,
            )
        )
        print_summary(results, dual_mode=args.dual)

    elif args.url:
        # Single URL mode
        output_path = Path(args.output) if args.output and not args.dual else None

        result = asyncio.run(
            process_url(
                args.url,
                output_path,
                dual_mode=args.dual,
                work_dir=args.work_dir,
                verbose=args.verbose,
                local_only=args.local,
            )
        )

        if result.success:
            if args.dual:
                print("\nExtractions saved. Next steps:")
                print("  1. Compare: select-extraction skill on:")
                if result.traf_path:
                    print(f"       - {result.traf_path}")
                if result.read_path:
                    print(f"       - {result.read_path}")
                print("  2. Cleanup: cleanup-extraction skill on selected file")
            elif output_path:
                print(f"Saved to {output_path}")
            else:
                frontmatter = build_frontmatter(result.metadata)
                print(frontmatter + result.content)
        else:
            print(f"Error: {result.error}", file=sys.stderr)
            sys.exit(1)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
