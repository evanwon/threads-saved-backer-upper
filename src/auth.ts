import { chromium, type BrowserContext } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SESSION_PATH = resolve("session.json");

export async function loadSession(): Promise<object | null> {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export async function login(): Promise<BrowserContext> {
  console.log("Opening browser for login. Please log in to Threads...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.threads.net/login");
  console.log("Waiting for you to complete login...");

  // Wait for navigation away from login page (up to 5 minutes)
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 300_000,
  });
  console.log("Login detected. Saving session...");

  const state = await context.storageState();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2));

  return context;
}

export async function isSessionValid(
  context: BrowserContext
): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto("https://www.threads.net/saved", {
      waitUntil: "domcontentloaded",
    });
    // If redirected to login, session is invalid
    const url = page.url();
    return !url.includes("/login");
  } finally {
    await page.close();
  }
}

export async function authenticate(): Promise<{
  context: BrowserContext;
  closeBrowser: () => Promise<void>;
}> {
  const savedState = await loadSession();

  if (savedState) {
    console.log("Found saved session, validating...");
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      storageState: savedState as any,
    });

    if (await isSessionValid(context)) {
      console.log("Session is valid.");
      return { context, closeBrowser: () => browser.close() };
    }

    console.log("Session expired.");
    await browser.close();
  }

  // Need fresh login
  const context = await login();
  const closeBrowser = async () => {
    await context.browser()?.close();
  };
  return { context, closeBrowser };
}
