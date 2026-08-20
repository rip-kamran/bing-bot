const { chromium } = require('playwright');

const EMAIL = process.env.MS_EMAIL || '';
const PASSWORD = process.env.MS_PASSWORD || '';

const SEARCHES = [
  'weather', 'news', 'sports', 'music', 'movies', 'games',
  'food', 'travel', 'animals', 'space', 'coding', 'history',
  'science', 'fitness', 'shopping', 'cars', 'art', 'ocean',
  'plants', 'stars', 'dogs', 'cats', 'math', 'school',
  'fashion', 'jobs', 'money', 'health', 'funny', 'sleep'
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dump(page, label) {
  const url = page.url();
  const text = ((await page.locator('body').innerText().catch(() => '')) || '')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
  console.log('[' + label + '] ' + url);
  console.log('[' + label + '] ' + (text || '(no visible text)'));
  await page.screenshot({ path: 'debug.png', fullPage: true }).catch(() => {});
}

async function clickFirst(page, selectors, timeout) {
  const loc = page.locator(selectors).first();
  await loc.waitFor({ state: 'visible', timeout: timeout || 15000 });
  await loc.click();
}

async function fillFirst(page, selectors, value, timeout) {
  const loc = page.locator(selectors).first();
  await loc.waitFor({ state: 'visible', timeout: timeout || 20000 });
  await loc.click();
  await loc.fill('');
  await loc.fill(value);
}

async function tryClick(page, selectors, timeout) {
  try {
    await clickFirst(page, selectors, timeout || 2500);
    return true;
  } catch (e) {
    return false;
  }
}

function isLoginUrl(url) {
  return /login\.live\.com|login\.microsoftonline\.com|account\.live\.com|signup\.live/i.test(url);
}

async function loginWithPassword(page) {
  if (!EMAIL || !PASSWORD) throw new Error('MS_EMAIL / MS_PASSWORD secrets are missing.');

  console.log('Opening Bing sign-in...');
  await page.goto('https://www.bing.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);
  await dump(page, 'bing-home');

  const signedIn = await page.locator('#id_n, .id_button, a[aria-label*="Account"]').first().isVisible().catch(() => false);
  if (signedIn) {
    const name = await page.locator('#id_n').innerText().catch(() => '');
    if (name && name.trim() && name.trim().toLowerCase() !== 'sign in') {
      console.log('Already signed in as ' + name);
      return;
    }
  }

  const clickedSignIn = await tryClick(
    page,
    '#id_s, a#id_l, a[href*="login.live.com"], a[href*="signin"], text=Sign in',
    5000
  );
  if (!clickedSignIn) {
    await page.goto(
      'https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=162&wp=MBI_SSL&wreply=' +
        encodeURIComponent('https://www.bing.com/') +
        '&id=264960',
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
  }
  await sleep(3000);
  await dump(page, 'after-signin-click');

  const emailSel = 'input[name="loginfmt"], input[type="email"], input[name="username"]';
  await fillFirst(page, emailSel, EMAIL, 25000);
  await tryClick(page, '#idSIButtonNext, input[type="submit"], button[type="submit"]', 8000);
  await sleep(4000);
  await dump(page, 'after-email');

  await tryClick(page, 'a#idA_PWD_SwitchToPassword, text=Use your password, text=Sign in with a password', 4000);
  await sleep(1500);

  const passSel = 'input[name="passwd"], input[type="password"]';
  const passVisible = await page.locator(passSel).first().isVisible().catch(() => false);
  if (passVisible) {
    await fillFirst(page, passSel, PASSWORD, 15000);
    await tryClick(page, '#idSIButtonNext, input[type="submit"], button[type="submit"]', 8000);
    await sleep(3000);
    await dump(page, 'after-password');
  } else {
    console.log('No password box — Microsoft may be sending a 2FA prompt now.');
  }

  await tryClick(page, '#idSIButtonNext, #acceptButton, input[value="Yes"]', 4000);

  console.log('>>> APPROVE THE SIGN-IN IN MICROSOFT AUTHENTICATOR ON YOUR IPAD. Waiting 3 minutes...');
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await tryClick(page, '#idSIButtonNext, #acceptButton, input[value="Yes"]', 800);
    const url = page.url();
    const text = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    if (text) console.log(text.slice(0, 300));
    if (!isLoginUrl(url)) {
      console.log('Left login page.');
      break;
    }
    if (/incorrect|wrong password|doesn't exist|couldn.t find/i.test(text)) {
      throw new Error('Microsoft rejected the password: ' + text.slice(0, 200));
    }
    await sleep(8000);
  }

  await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  await dump(page, 'rewards');
  if (isLoginUrl(page.url()) || /sign in/i.test((await page.locator('body').innerText().catch(() => '')) || '')) {
    throw new Error('Still not signed in after 2FA wait.');
  }
  console.log('Logged in.');
}

async function doSearches(page, label, count, offset) {
  for (let i = 0; i < count; i++) {
    const term = SEARCHES[(i + offset) % SEARCHES.length] + ' ' + (Date.now() % 10000);
    await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(term), {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    console.log(label + ' ' + (i + 1) + '/' + count + ': ' + term);
    await sleep(6000 + Math.random() * 4000);
  }
}

async function run() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    await loginWithPassword(page);

    console.log('Starting desktop searches...');
    await doSearches(page, 'Desktop', 30, 0);

    console.log('Starting mobile searches...');
    const mobile = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
    });
    await mobile.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await mobile.addCookies(await context.cookies());
    const mobilePage = await mobile.newPage();
    await doSearches(mobilePage, 'Mobile', 20, 10);
    await mobile.close();

    console.log('Checking Daily Set...');
    await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    const tiles = page.locator('[class*="offer"], [class*="card"], [class*="tile"]');
    const n = Math.min(await tiles.count(), 3);
    for (let i = 0; i < n; i++) {
      try {
        await tiles.nth(i).click({ timeout: 3000 });
        await sleep(6000);
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(2000);
      } catch (e) {}
    }

    console.log('All done!');
    await browser.close();
  } catch (err) {
    console.error('Error: ' + err.message);
    await dump(page, 'error').catch(() => {});
    await browser.close();
    process.exit(1);
  }
}

run();
