#!/usr/bin/env node
/**
 * Batch-sync pending Substack subscribers using Playwright with stealth plugin.
 *
 * Called by APScheduler ~4x/day. Opens one browser session, processes all
 * pending emails, then exits.
 *
 * Usage:
 *   export SUBSTACK_COOKIES="substack.sid=...; cf_clearance=...; ..."
 *   export API_PORT=8200  # optional, defaults to 8000
 *   node scripts/sync-substack.mjs
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const SUBSTACK_URL = "https://lensacademy.substack.com";
const API_PORT = process.env.API_PORT || "8000";
const API_BASE = `http://localhost:${API_PORT}`;

function parseCookies(cookieString) {
  return cookieString.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return {
      name: name.trim(),
      value: rest.join("=").trim(),
      domain: ".substack.com",
      path: "/",
      secure: true,
      sameSite: "None",
    };
  });
}

function randomDelay(minMs, maxMs) {
  return new Promise((resolve) =>
    setTimeout(resolve, minMs + Math.random() * (maxMs - minMs))
  );
}

async function main() {
  // 1. Fetch pending emails from our API
  const pendingResp = await fetch(
    `${API_BASE}/api/subscribe/pending-substack`
  );
  if (!pendingResp.ok) {
    console.error(
      `Failed to fetch pending emails: ${pendingResp.status} ${pendingResp.statusText}`
    );
    process.exit(1);
  }
  const { emails } = await pendingResp.json();

  if (emails.length === 0) {
    console.log("No pending Substack subscribers to sync.");
    process.exit(0);
  }

  console.log(`${emails.length} email(s) to sync to Substack.`);

  // 2. Check cookies
  const cookieString = process.env.SUBSTACK_COOKIES;
  if (!cookieString) {
    console.error(
      "SUBSTACK_COOKIES not set.\n" +
        "Get the full cookie header from browser DevTools -> Network -> any substack.com request -> cookie header\n" +
        'Then: export SUBSTACK_COOKIES="substack.sid=...; cf_clearance=...; ..."'
    );
    process.exit(1);
  }

  // 3. Launch browser and navigate once
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  });

  const cookies = parseCookies(cookieString);
  await context.addCookies(cookies);

  const page = await context.newPage();
  await page.goto(SUBSTACK_URL, { waitUntil: "networkidle" });

  const title = await page.title();
  if (title.includes("Just a moment") || title.includes("Attention")) {
    console.error("Cloudflare challenge detected — cookies may be expired");
    await browser.close();
    process.exit(1);
  }

  console.log(`Page loaded: ${title}`);

  // 4. Process each email
  let synced = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      const result = await page.evaluate(async (subscriberEmail) => {
        try {
          const resp = await fetch("/api/v1/free", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: subscriberEmail,
              source: "subscribe_page",
              first_url: window.location.href,
              first_referrer: "",
              current_url: window.location.href,
              current_referrer: "",
              referral_code: "",
              referring_pub_id: "",
              additional_referring_pub_ids: "",
            }),
          });
          const text = await resp.text();
          try {
            return { status: resp.status, data: JSON.parse(text) };
          } catch {
            return { status: resp.status, body: text.substring(0, 300) };
          }
        } catch (e) {
          return { error: e.message };
        }
      }, email);

      if (result.error || result.body) {
        console.error(`  FAIL ${email}: ${JSON.stringify(result)}`);
        failed++;
        continue;
      }

      // Mark as synced in our DB
      const markResp = await fetch(`${API_BASE}/api/subscribe/mark-synced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!markResp.ok) {
        console.error(
          `  WARN ${email}: synced to Substack but failed to mark in DB`
        );
      }

      const status = result.data?.requires_confirmation ? "pending" : "ok";
      console.log(`  OK ${email} (${status})`);
      synced++;
    } catch (err) {
      console.error(`  FAIL ${email}: ${err.message}`);
      failed++;
    }

    // Random delay between requests (2-10 seconds)
    if (email !== emails[emails.length - 1]) {
      await randomDelay(2000, 10000);
    }
  }

  await browser.close();
  console.log(`Done. Synced: ${synced}, Failed: ${failed}`);
}

await main();
