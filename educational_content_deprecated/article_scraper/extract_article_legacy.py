#!/usr/bin/env python3
"""
Extract web articles with images using trafilatura + custom image injection.

Trafilatura is excellent for extracting clean article text, but it often removes
images (especially linked images) due to its link density filter. This script:
1. Uses trafilatura for clean text extraction
2. Extracts images from original HTML
3. Injects images back at appropriate positions
4. Adds front matter (title, author, date, source)

Usage:
    python extract_article.py "URL" output.md
    python extract_article.py "URL" output.md --author "Name" --date "Date"
"""

import sys
import re
import argparse
import requests
from lxml import html
from trafilatura import extract, bare_extraction


def fix_formatting(content: str) -> str:
    """Light cleanup - just collapse blank lines.

    More complex formatting fixes (bold/italic spacing) should be done
    by an AI using the clean-article.skill.md skill.
    """
    result = content

    # Collapse multiple blank lines to single blank line
    result = re.sub(r"\n{3,}", "\n\n", result)

    # Clean up trailing whitespace
    result = "\n".join(line.rstrip() for line in result.split("\n"))

    return result


def extract_with_images(url: str) -> tuple[str | None, dict]:
    """Extract article with images using trafilatura + custom image injection.

    Returns:
        tuple: (markdown_content, metadata_dict)
        metadata_dict contains: title, author, date (if found)
    """
    metadata = {"url": url, "title": None, "author": None, "date": None}

    # Fetch page
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"Error fetching URL: {e}", file=sys.stderr)
        return None, metadata

    raw_html = r.text
    tree = html.fromstring(raw_html)

    # Extract metadata using bare_extraction
    doc = bare_extraction(raw_html)
    if doc:
        metadata["title"] = doc.title
        metadata["author"] = doc.author
        metadata["date"] = doc.date

    # Step 1: Get markdown from trafilatura
    # Note: output may have formatting issues (spaces inside asterisks)
    # Use clean-article.skill.md with a subagent to fix these
    clean_md = extract(raw_html, output_format="markdown", include_formatting=True)
    if not clean_md:
        print("Trafilatura returned no content", file=sys.stderr)
        return None, metadata

    # Step 2: Find content container
    content_selectors = [
        '//div[contains(@class,"entry-content")]',
        '//article//div[contains(@class,"content")]',
        "//article",
        '//div[contains(@class,"post-content")]',
        '//div[contains(@class,"article-content")]',
        "//main",
    ]

    content_div = None
    for sel in content_selectors:
        matches = tree.xpath(sel)
        if matches:
            content_div = matches[0]
            break

    if content_div is None:
        print(
            "Could not find content container, returning without images",
            file=sys.stderr,
        )
        return clean_md, metadata

    # Step 3: Extract (preceding_text, image_md) pairs
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

            # Filter valid images
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

    # Step 4: Insert images into markdown
    result = clean_md
    inserted_images = set()  # Avoid duplicates

    for text_marker, image_md in image_insertions:
        # Skip if we already inserted this image
        if image_md in inserted_images:
            continue

        # Strip only asterisks and brackets (markdown formatting), keep parentheses
        marker_clean = (
            text_marker[:50].replace("*", "").replace("[", "").replace("]", "")
        )
        marker_clean = marker_clean[:40]

        # Search in a stripped version of the result to find position
        result_stripped = re.sub(r"\*+", "", result)
        marker_escaped = re.escape(marker_clean)
        pattern = rf"{marker_escaped}[^\n]*\n"
        match = re.search(pattern, result_stripped)

        if match:
            # Find the corresponding position in the original result
            # by counting how many chars into result_stripped the match ends
            stripped_end = match.end()

            # Map back to original: walk through result, skipping asterisks
            orig_pos = 0
            stripped_pos = 0
            while stripped_pos < stripped_end and orig_pos < len(result):
                if result[orig_pos] == "*":
                    orig_pos += 1
                else:
                    orig_pos += 1
                    stripped_pos += 1

            result = result[:orig_pos] + image_md + result[orig_pos:]
            inserted_images.add(image_md)

    # Step 5: Light formatting cleanup
    result = fix_formatting(result)

    return result, metadata


def build_front_matter(
    metadata: dict,
    title_override: str = None,
    author_override: str = None,
    date_override: str = None,
) -> str:
    """Build YAML front matter from metadata."""
    title = title_override or metadata.get("title") or "Untitled"
    author = author_override or metadata.get("author") or "Unknown"
    date = date_override or metadata.get("date")
    url = metadata.get("url", "")

    lines = ["---"]
    lines.append(f'title: "{title}"')
    lines.append(f"author: {author}")
    if date:
        lines.append(f"date: {date}")
    lines.append(f"source_url: {url}")
    lines.append("---")
    lines.append("")

    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(
        description="Extract web articles with images to markdown.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("url", help="URL of the article to extract")
    parser.add_argument(
        "output",
        nargs="?",
        help="Output file path (optional, prints to stdout if not specified)",
    )
    parser.add_argument("--title", help="Override article title")
    parser.add_argument("--author", help="Override author name")
    parser.add_argument("--date", help="Override date")
    parser.add_argument(
        "--no-frontmatter", action="store_true", help="Skip adding front matter"
    )

    args = parser.parse_args()

    content, metadata = extract_with_images(args.url)

    if content is None:
        sys.exit(1)

    # Add front matter unless disabled
    if not args.no_frontmatter:
        front_matter = build_front_matter(metadata, args.title, args.author, args.date)
        content = front_matter + content

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Saved to {args.output}", file=sys.stderr)
        print(
            f"Title: {args.title or metadata.get('title') or 'Unknown'}",
            file=sys.stderr,
        )
        print(
            f"Author: {args.author or metadata.get('author') or 'Unknown'}",
            file=sys.stderr,
        )
        print(
            f"Date: {args.date or metadata.get('date') or 'Unknown'}", file=sys.stderr
        )
    else:
        print(content)


if __name__ == "__main__":
    main()
