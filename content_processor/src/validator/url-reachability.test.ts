// src/validator/url-reachability.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateUrls } from './url-reachability.js';

describe('validateUrls', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns no warnings for reachable URLs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const urls = [
      { url: 'https://example.com/img.png', file: 'articles/test.md', line: 10, label: 'Image URL' },
    ];

    const errors = await validateUrls(urls);
    expect(errors).toHaveLength(0);
  });

  it('returns warning for unreachable URL (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const urls = [
      { url: 'https://example.com/broken.png', file: 'articles/test.md', line: 10, label: 'Image URL' },
    ];

    const errors = await validateUrls(urls);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('warning');
    expect(errors[0].message).toContain('broken.png');
    expect(errors[0].file).toBe('articles/test.md');
    expect(errors[0].line).toBe(10);
  });

  it('returns warning for timeout (AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const urls = [
      { url: 'https://example.com/slow.png', file: 'articles/test.md', line: 15, label: 'Image URL' },
    ];

    const errors = await validateUrls(urls);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('warning');
    expect(errors[0].message).toContain('timed out');
  });

  it('returns warning for HTTP 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const urls = [
      { url: 'https://example.com/missing.png', file: 'articles/test.md', line: 20, label: 'Image URL' },
    ];

    const errors = await validateUrls(urls);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('warning');
    expect(errors[0].message).toContain('404');
  });

  it('treats HTTP 429 (rate limited) as reachable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });

    const urls = [
      { url: 'https://archive.is/blU6r', file: 'articles/test.md', line: 2, label: 'source_url' },
    ];

    const errors = await validateUrls(urls);
    expect(errors).toHaveLength(0);
  });

  it('falls back to GET when HEAD returns 405', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 405 })  // HEAD fails
      .mockResolvedValueOnce({ ok: true, status: 200 });   // GET succeeds

    const urls = [
      { url: 'https://lensacademy.org', file: 'articles/test.md', line: 2, label: 'source_url' },
    ];

    const errors = await validateUrls(urls);
    expect(errors).toHaveLength(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('warns when both HEAD and GET fail', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 405 })  // HEAD fails
      .mockResolvedValueOnce({ ok: false, status: 500 });  // GET also fails

    const urls = [
      { url: 'https://example.com/broken', file: 'articles/test.md', line: 2, label: 'source_url' },
    ];

    const errors = await validateUrls(urls);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('500');
  });

  it('returns empty array for empty input', async () => {
    const errors = await validateUrls([]);
    expect(errors).toEqual([]);
  });

  it('uses the label in messages', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const urls = [
      { url: 'https://example.com/article', file: 'articles/test.md', line: 2, label: 'source_url' },
    ];

    const errors = await validateUrls(urls);
    expect(errors[0].message).toContain('source_url');
  });
});
