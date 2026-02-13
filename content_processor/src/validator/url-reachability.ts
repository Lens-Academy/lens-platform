// src/validator/url-reachability.ts
import type { ContentError } from '../index.js';

export interface UrlToValidate {
  url: string;
  file: string;
  line: number;
  label: string;  // e.g. "Image URL", "source_url", "video url"
}

const CONCURRENCY = 10;
const TIMEOUT_MS = 15_000;

// Status codes that mean "server is alive" even though response.ok is false
const REACHABLE_STATUSES = new Set([429]);

async function fetchWithTimeout(url: string, method: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { method, signal });
}

async function checkUrl(entry: UrlToValidate): Promise<ContentError | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response = await fetchWithTimeout(entry.url, 'HEAD', controller.signal);

    // Some servers reject HEAD — retry with GET
    if (response.status === 405) {
      response = await fetchWithTimeout(entry.url, 'GET', controller.signal);
    }

    clearTimeout(timeout);

    if (!response.ok && !REACHABLE_STATUSES.has(response.status)) {
      return {
        file: entry.file,
        line: entry.line,
        message: `${entry.label} returned HTTP ${response.status}: ${entry.url}`,
        severity: 'warning',
      };
    }
    return null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        file: entry.file,
        line: entry.line,
        message: `${entry.label} timed out: ${entry.url}`,
        severity: 'warning',
      };
    }
    return {
      file: entry.file,
      line: entry.line,
      message: `${entry.label} unreachable: ${entry.url}`,
      severity: 'warning',
    };
  }
}

export async function validateUrls(
  urls: UrlToValidate[],
): Promise<ContentError[]> {
  if (urls.length === 0) return [];

  const warnings: ContentError[] = [];

  // Process in batches to avoid overwhelming servers/network
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(checkUrl));
    for (const result of results) {
      if (result) warnings.push(result);
    }
  }

  return warnings;
}
