#!/usr/bin/env python3
"""
Test suite for comparing article extraction tools.

Tests multiple extractors against a set of URLs and reports quality metrics.
No LLM processing - pure extraction comparison.

Usage:
    python test_extractors.py                    # Run all tests
    python test_extractors.py --url URL          # Test single URL
    python test_extractors.py --category blog    # Test one category
    python test_extractors.py --quick            # First 3 URLs only
"""

import argparse
import asyncio
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

# Optional imports - gracefully degrade if not installed
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


@dataclass
class ExtractionResult:
    """Result from a single extraction attempt."""

    success: bool
    content: str = ""
    title: Optional[str] = None
    author: Optional[str] = None
    date: Optional[str] = None
    word_count: int = 0
    char_count: int = 0
    image_count: int = 0
    time_ms: int = 0
    error: Optional[str] = None


@dataclass
class TestURL:
    """A URL to test with metadata."""

    url: str
    category: str = "unknown"
    difficulty: str = "unknown"
    notes: str = ""


def parse_test_urls(filepath: Path) -> list[TestURL]:
    """Parse test_urls.txt into TestURL objects."""
    urls = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            # Skip comments and empty lines
            if not line or line.startswith("#"):
                continue

            # Parse: URL | category | difficulty | notes
            parts = [p.strip() for p in line.split("|")]
            url = parts[0]

            if not url.startswith("http"):
                continue

            category = parts[1] if len(parts) > 1 else "unknown"
            difficulty = parts[2] if len(parts) > 2 else "unknown"
            notes = parts[3] if len(parts) > 3 else ""

            urls.append(
                TestURL(url=url, category=category, difficulty=difficulty, notes=notes)
            )

    return urls


async def fetch_html(url: str, timeout: int = 30) -> tuple[str, Optional[str]]:
    """Fetch HTML from URL. Returns (html, error)."""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
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


async def fetch_pdf(url: str, timeout: int = 30) -> tuple[bytes, Optional[str]]:
    """Fetch PDF bytes from URL. Returns (bytes, error)."""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.get(url, timeout=timeout)
            r.raise_for_status()
            return r.content, None
    except Exception as e:
        return b"", str(e)[:50]


def count_images(content: str) -> int:
    """Count markdown images in content."""
    return len(re.findall(r"!\[.*?\]\(.*?\)", content))


def count_words(content: str) -> int:
    """Count words in content."""
    return len(content.split())


# === Extractors ===


def extract_trafilatura(html: str) -> ExtractionResult:
    """Extract using trafilatura."""
    if not HAS_TRAFILATURA:
        return ExtractionResult(success=False, error="trafilatura not installed")

    start = time.time()
    try:
        # Get metadata
        doc = bare_extraction(html)
        title = doc.title if doc else None
        author = doc.author if doc else None
        date = doc.date if doc else None

        # Get content as markdown
        content = trafilatura.extract(
            html, output_format="markdown", include_formatting=True, include_images=True
        )

        if not content:
            return ExtractionResult(
                success=False,
                error="no_content",
                time_ms=int((time.time() - start) * 1000),
            )

        return ExtractionResult(
            success=True,
            content=content,
            title=title,
            author=author,
            date=date,
            word_count=count_words(content),
            char_count=len(content),
            image_count=count_images(content),
            time_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return ExtractionResult(
            success=False, error=str(e)[:50], time_ms=int((time.time() - start) * 1000)
        )


def extract_readability(html: str) -> ExtractionResult:
    """Extract using readability-lxml."""
    if not HAS_READABILITY:
        return ExtractionResult(success=False, error="readability not installed")

    start = time.time()
    try:
        doc = Document(html)
        title = doc.title()
        # Readability returns HTML, convert to rough markdown
        html_content = doc.summary()

        # Simple HTML to markdown conversion (no dependencies)
        content = html_content
        content = re.sub(r"<h1[^>]*>(.*?)</h1>", r"# \1\n", content, flags=re.DOTALL)
        content = re.sub(r"<h2[^>]*>(.*?)</h2>", r"## \1\n", content, flags=re.DOTALL)
        content = re.sub(r"<h3[^>]*>(.*?)</h3>", r"### \1\n", content, flags=re.DOTALL)
        content = re.sub(r"<p[^>]*>(.*?)</p>", r"\1\n\n", content, flags=re.DOTALL)
        content = re.sub(r"<br\s*/?>", "\n", content)
        content = re.sub(r"<strong>(.*?)</strong>", r"**\1**", content, flags=re.DOTALL)
        content = re.sub(r"<em>(.*?)</em>", r"*\1*", content, flags=re.DOTALL)
        content = re.sub(
            r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
            r"[\2](\1)",
            content,
            flags=re.DOTALL,
        )
        content = re.sub(
            r'<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*/?>', r"![\2](\1)", content
        )
        content = re.sub(r'<img[^>]*src="([^"]*)"[^>]*/?>', r"![](\1)", content)
        content = re.sub(r"<[^>]+>", "", content)  # Strip remaining tags
        content = re.sub(r"\n{3,}", "\n\n", content)  # Collapse newlines
        content = content.strip()

        if not content or len(content) < 100:
            return ExtractionResult(
                success=False,
                error="no_content",
                time_ms=int((time.time() - start) * 1000),
            )

        return ExtractionResult(
            success=True,
            content=content,
            title=title,
            author=None,  # Readability doesn't extract author
            date=None,
            word_count=count_words(content),
            char_count=len(content),
            image_count=count_images(content),
            time_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return ExtractionResult(
            success=False, error=str(e)[:50], time_ms=int((time.time() - start) * 1000)
        )


def extract_pdf_pymupdf(pdf_bytes: bytes) -> ExtractionResult:
    """Extract text from PDF using PyMuPDF."""
    if not HAS_PYMUPDF:
        return ExtractionResult(success=False, error="pymupdf not installed")

    start = time.time()
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")

        # Extract text from all pages
        pages = []
        for page in doc:
            text = page.get_text()
            if text.strip():
                pages.append(text)

        content = "\n\n---\n\n".join(pages)

        # Try to get title from metadata
        metadata = doc.metadata
        title = metadata.get("title") if metadata else None
        author = metadata.get("author") if metadata else None

        doc.close()

        if not content or len(content) < 100:
            return ExtractionResult(
                success=False,
                error="no_content",
                time_ms=int((time.time() - start) * 1000),
            )

        return ExtractionResult(
            success=True,
            content=content,
            title=title,
            author=author,
            date=None,
            word_count=count_words(content),
            char_count=len(content),
            image_count=0,  # PDF text extraction doesn't include images
            time_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return ExtractionResult(
            success=False, error=str(e)[:50], time_ms=int((time.time() - start) * 1000)
        )


async def extract_jina(url: str) -> ExtractionResult:
    """Extract using Jina Reader API (free tier)."""
    start = time.time()
    try:
        jina_url = f"https://r.jina.ai/{url}"
        async with httpx.AsyncClient() as client:
            r = await client.get(jina_url, timeout=60)
            r.raise_for_status()
            content = r.text

        # Jina returns markdown with metadata header
        title = None
        if content.startswith("Title:"):
            lines = content.split("\n")
            for line in lines[:10]:
                if line.startswith("Title:"):
                    title = line[6:].strip()
                    break

        if not content or len(content) < 100:
            return ExtractionResult(
                success=False,
                error="no_content",
                time_ms=int((time.time() - start) * 1000),
            )

        return ExtractionResult(
            success=True,
            content=content,
            title=title,
            author=None,
            date=None,
            word_count=count_words(content),
            char_count=len(content),
            image_count=count_images(content),
            time_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return ExtractionResult(
            success=False, error=str(e)[:50], time_ms=int((time.time() - start) * 1000)
        )


async def extract_puremd(url: str) -> ExtractionResult:
    """Extract using pure.md API (free tier)."""
    start = time.time()
    try:
        puremd_url = f"https://pure.md/{url}"
        async with httpx.AsyncClient() as client:
            r = await client.get(puremd_url, timeout=60)
            r.raise_for_status()
            content = r.text

        # Parse frontmatter if present
        title = None
        if content.startswith("---"):
            end = content.find("---", 3)
            if end > 0:
                frontmatter = content[3:end]
                for line in frontmatter.split("\n"):
                    if line.startswith("title:"):
                        title = line[6:].strip().strip("\"'")
                        break

        if not content or len(content) < 100:
            return ExtractionResult(
                success=False,
                error="no_content",
                time_ms=int((time.time() - start) * 1000),
            )

        return ExtractionResult(
            success=True,
            content=content,
            title=title,
            author=None,
            date=None,
            word_count=count_words(content),
            char_count=len(content),
            image_count=count_images(content),
            time_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return ExtractionResult(
            success=False, error=str(e)[:50], time_ms=int((time.time() - start) * 1000)
        )


# === Test Runner ===


@dataclass
class TestResult:
    """Results for a single URL across all extractors."""

    url: TestURL
    fetch_error: Optional[str] = None
    trafilatura: Optional[ExtractionResult] = None
    readability: Optional[ExtractionResult] = None
    jina: Optional[ExtractionResult] = None
    puremd: Optional[ExtractionResult] = None
    pymupdf: Optional[ExtractionResult] = None


async def test_url(test_url: TestURL, include_apis: bool = False) -> TestResult:
    """Test all extractors on a single URL."""
    result = TestResult(url=test_url)

    is_pdf = test_url.url.lower().endswith(".pdf")

    if is_pdf:
        # PDF handling
        pdf_bytes, error = await fetch_pdf(test_url.url)
        if error:
            result.fetch_error = error
        else:
            result.pymupdf = extract_pdf_pymupdf(pdf_bytes)

        # APIs can also handle PDFs
        if include_apis:
            result.jina = await extract_jina(test_url.url)
            result.puremd = await extract_puremd(test_url.url)
    else:
        # HTML handling
        html, error = await fetch_html(test_url.url)
        if error:
            result.fetch_error = error
        else:
            # Local extractors (parallel via threads would be overkill here)
            result.trafilatura = extract_trafilatura(html)
            result.readability = extract_readability(html)

        # API extractors
        if include_apis:
            result.jina = await extract_jina(test_url.url)
            result.puremd = await extract_puremd(test_url.url)

    return result


def format_result(r: Optional[ExtractionResult], width: int = 12) -> str:
    """Format a single result for table display."""
    if r is None:
        return "-".center(width)
    if not r.success:
        return f"✗ {r.error or 'fail'}"[:width].center(width)
    return f"✓ {r.word_count}w".center(width)


def print_results(results: list[TestResult], include_apis: bool = False):
    """Print results as a table."""
    # Header
    cols = ["URL", "Trafila", "Readab"]
    if include_apis:
        cols.extend(["Jina", "Pure.md"])
    cols.append("PDF")

    print("\n" + "=" * 100)
    print("EXTRACTION TEST RESULTS")
    print("=" * 100)

    # Column widths
    url_width = 45
    col_width = 12

    # Print header
    header = f"{'URL':<{url_width}}"
    for col in cols[1:]:
        header += f"{col:^{col_width}}"
    print(header)
    print("-" * 100)

    # Print each result
    for r in results:
        # Truncate URL for display
        url_display = r.url.url
        if len(url_display) > url_width - 3:
            url_display = url_display[: url_width - 6] + "..."

        row = f"{url_display:<{url_width}}"

        if r.fetch_error:
            row += f"{'FETCH: ' + r.fetch_error:^{col_width * (len(cols) - 1)}}"
        else:
            row += format_result(r.trafilatura, col_width)
            row += format_result(r.readability, col_width)
            if include_apis:
                row += format_result(r.jina, col_width)
                row += format_result(r.puremd, col_width)
            row += format_result(r.pymupdf, col_width)

        print(row)

    # Summary
    print("-" * 100)

    def count_success(extractor: str) -> tuple[int, int]:
        success = 0
        total = 0
        for r in results:
            result = getattr(r, extractor, None)
            if result is not None:
                total += 1
                if result.success:
                    success += 1
        return success, total

    summary = f"{'SUCCESS RATE':<{url_width}}"
    for ext in ["trafilatura", "readability"]:
        s, t = count_success(ext)
        if t > 0:
            summary += f"{s}/{t} ({100 * s // t}%)".center(col_width)
        else:
            summary += "-".center(col_width)

    if include_apis:
        for ext in ["jina", "puremd"]:
            s, t = count_success(ext)
            if t > 0:
                summary += f"{s}/{t} ({100 * s // t}%)".center(col_width)
            else:
                summary += "-".center(col_width)

    s, t = count_success("pymupdf")
    if t > 0:
        summary += f"{s}/{t} ({100 * s // t}%)".center(col_width)
    else:
        summary += "-".center(col_width)

    print(summary)
    print("=" * 100)

    # Detailed comparison for successful extractions
    print("\nDETAILED METRICS (successful extractions only):")
    print("-" * 80)

    for r in results:
        if r.fetch_error:
            continue

        print(f"\n{r.url.url[:70]}...")
        print(f"  Category: {r.url.category} | Difficulty: {r.url.difficulty}")

        for name, result in [
            ("Trafilatura", r.trafilatura),
            ("Readability", r.readability),
            ("Jina", r.jina),
            ("Pure.md", r.puremd),
            ("PyMuPDF", r.pymupdf),
        ]:
            if result and result.success:
                meta = []
                if result.title:
                    meta.append(f"title='{result.title[:30]}...'")
                if result.author:
                    meta.append(f"author='{result.author}'")
                if result.image_count:
                    meta.append(f"images={result.image_count}")
                meta_str = ", ".join(meta) if meta else "no metadata"
                print(
                    f"  {name:12}: {result.word_count:,} words, {result.char_count:,} chars, {result.time_ms}ms | {meta_str}"
                )


async def main():
    parser = argparse.ArgumentParser(description="Test article extraction tools")
    parser.add_argument("--url", help="Test a single URL")
    parser.add_argument("--category", help="Test only URLs in this category")
    parser.add_argument("--quick", action="store_true", help="Test only first 3 URLs")
    parser.add_argument(
        "--apis", action="store_true", help="Include API extractors (Jina, pure.md)"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Show detailed output"
    )

    args = parser.parse_args()

    # Check dependencies
    print("Available extractors:")
    print(f"  trafilatura: {'✓' if HAS_TRAFILATURA else '✗ (pip install trafilatura)'}")
    print(
        f"  readability: {'✓' if HAS_READABILITY else '✗ (pip install readability-lxml)'}"
    )
    print(f"  pymupdf:     {'✓' if HAS_PYMUPDF else '✗ (pip install pymupdf)'}")
    print(f"  jina:        {'✓ (API)' if args.apis else '- (use --apis)'}")
    print(f"  pure.md:     {'✓ (API)' if args.apis else '- (use --apis)'}")
    print()

    # Load URLs
    script_dir = Path(__file__).parent
    urls_file = script_dir / "test_urls.txt"

    if args.url:
        test_urls = [TestURL(url=args.url)]
    else:
        test_urls = parse_test_urls(urls_file)

        if args.category:
            test_urls = [u for u in test_urls if u.category == args.category]

        if args.quick:
            test_urls = test_urls[:3]

    print(f"Testing {len(test_urls)} URLs...")
    print()

    # Run tests
    results = []
    for i, url in enumerate(test_urls, 1):
        print(f"[{i}/{len(test_urls)}] {url.url[:60]}...", end=" ", flush=True)
        result = await test_url(url, include_apis=args.apis)

        # Quick status
        if result.fetch_error:
            print(f"FETCH ERROR: {result.fetch_error}")
        else:
            statuses = []
            if result.trafilatura:
                statuses.append(f"T:{'✓' if result.trafilatura.success else '✗'}")
            if result.readability:
                statuses.append(f"R:{'✓' if result.readability.success else '✗'}")
            if result.pymupdf:
                statuses.append(f"PDF:{'✓' if result.pymupdf.success else '✗'}")
            if args.apis:
                if result.jina:
                    statuses.append(f"J:{'✓' if result.jina.success else '✗'}")
                if result.puremd:
                    statuses.append(f"P:{'✓' if result.puremd.success else '✗'}")
            print(" ".join(statuses))

        results.append(result)

    # Print summary table
    print_results(results, include_apis=args.apis)


if __name__ == "__main__":
    asyncio.run(main())
