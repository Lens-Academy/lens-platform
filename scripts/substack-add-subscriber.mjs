#!/usr/bin/env node
/**
 * Add a subscriber to Substack using Playwright with stealth plugin.
 *
 * Usage:
 *   export SUBSTACK_COOKIES="substack.sid=...; cf_clearance=...; ..."
 *   node scripts/substack-add-subscriber.mjs test@example.com
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const SUBSTACK_URL = "https://lensacademy.substack.com";

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

async function addSubscriber(email) {
  const cookieString = process.env.SUBSTACK_COOKIES;
  if (!cookieString) {
    console.error(
      "SUBSTACK_COOKIES not set.\n" +
        "Get the full cookie header from browser DevTools → Network → any substack.com request → cookie header\n" +
        'Then: export SUBSTACK_COOKIES="substack.sid=...; cf_clearance=...; ..."'
    );
    process.exit(1);
  }

  console.log(`Adding subscriber: ${email}`);

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
  console.log("Page title:", title);

  if (title.includes("Just a moment") || title.includes("Attention")) {
    console.error("Cloudflare challenge detected — cookies may be expired");
    await browser.close();
    process.exit(1);
  }

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

  console.log("Result:", JSON.stringify(result, null, 2));
  await browser.close();

  if (result.error || result.body) {
    console.error("Failed to add subscriber");
    process.exit(1);
  }

  if (result.data?.requires_confirmation) {
    console.log("⚠ Subscriber added (pending email confirmation)");
  } else {
    console.log("✓ Subscriber added successfully");
  }
}

const email = process.argv[2];
if (!email) {
  console.log("Usage: node scripts/substack-add-subscriber.mjs EMAIL");
  console.log("\nRequires SUBSTACK_COOKIES env var");
  process.exit(1);
}

await addSubscriber(email);
