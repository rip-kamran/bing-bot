const { chromium } = require('playwright');

const EMAIL = process.env.MS_EMAIL || '';
const PASSWORD = process.env.MS_PASSWORD || '';
const COOKIES_RAW = process.env.MS_COOKIES || '';

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

function parseCookies(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  const toCookie = (c) => ({
    name: c.name,
    value: String(c.value ?? ''),
    domain: c.domain || '.bing.com',
    path: c.path || '/',
    httpOnly: Boolean(c.httpOnly),
    secure: c.secure !== false,
  });
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : parsed.cookies;
    return (arr || []).filter((c) => c && c.name && c.value != null).map(toCookie);
  }
  if (!trimmed.includes(';') && !/_U=/i.test(trimmed)) {
    return [{ name: '_U', value: trimmed, domain: '.bing.com', path: '/', secure: true }];
  }
  return trimmed
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx < 1) return null;
      return {
        name: part.slice(0, idx).trim(),
        value: part.slice(idx + 1).trim(),
        domain: '.bing.com',
        path: '/',
        secure: true,
      };
    })
    .filter(Boolean);
}

async function clickNext(page) {
  const btn = page.locator('#idSIButtonNext, input[type="submit"], button[type="submit"]').first();
  await btn.click({ timeout: 20000 });
}

async function loginWithPassword(page) {
  if (!EMAIL || !PASSWORD) {
    throw new Error('MS_EMAIL / MS_PASSWORD secrets are missing.');
  }

  console.log('Logging in as ' + EMAIL + ' ...');
  await page.goto('https://login.live.com/', { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  const emailBox = page.locator('input[name="loginfmt"], input[type="email"]').first();
  await emailBox.waitFor({ timeout: 20000 });
  await emailBox.fill(EMAIL);
  await clickNext(page);
  await sleep(2500);

  const passBox = page.locator('input[name="passwd"], input[type="password"]').first();
  await passBox.waitFor({ timeout: 25000 });
  await passBox.fill(PASSWORD);
  await clickNext(page);
  await sleep(3000);

  try {
    await page.locator('#idSIButtonNext').click({ timeout: 5000 });
  } catch (e) {}

  console.log('>>> APPROVE THE SIGN-IN ON YOUR IPAD NOW (Microsoft Authenticator). Waiting 3 minutes...');

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const url = page.url();
    const text = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 800);
    console.log('Login page: ' + url);
    if (text) console.log(text.replace(/\s+/g, ' ').slice(0, 400));

    try {
      await page.locator('#idSIButtonNext, #acceptButton, input[value="Yes"]').first().click({ timeout: 800 });
    } catch (e) {}

    if (!/login\.live\.com|login\.microsoftonline\.com|account\.live\.com/i.test(url)) {
      console.log('Left the login page — assuming 2FA was approved.');
      break;
    }
    await sleep(8000);
  }

  await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const url = page.url();
  if (/login|signin/i.test(url)) {
    throw new Error('Still on login after 2FA wait. Approve Authenticator faster next time, or 2FA number-match is required.');
  }
  console.log('Logged in.');
}

async function assertLoggedIn(page) {
  await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const url = page.url();
  if (/login|signin|oauth/i.test(url)) {
    throw new Error('Not signed in.');
  }
  console.log('Rewards page OK.');
}

async function doSearches(page, label, count, offset) {
  for (let i = 0; i < count; i++) {
    let term = SEARCHES[(i + offset) % SEARCHES.length] + ' ' + (Date.now() % 10000);
    await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(term), {
      waitUntil: 'domcontentloaded',
    });
    console.log(label + ' ' + (i + 1) + '/' + count + ': ' + term);
    await sleep(6000 + Math.random() * 4000);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  try {
    const cookies = COOKIES_RAW.trim() ? parseCookies(COOKIES_RAW) : [];
    if (cookies.length) {
      console.log('Using ' + cookies.length + ' cookie(s).');
      await desktop.addCookies(cookies);
    }

    const page = await desktop.newPage();

    if (cookies.length) {
      try {
        await assertLoggedIn(page);
      } catch (e) {
        console.log('Cookies did not work, falling back to password + 2FA.');
        await loginWithPassword(page);
      }
    } else {
      await loginWithPassword(page);
    }

    console.log('Starting desktop searches...');
    await doSearches(page, 'Desktop', 30, 0);

    console.log('Starting mobile searches...');
    const mobile = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    if (cookies.length) await mobile.addCookies(cookies);
    const mobilePage = await mobile.newPage();
    const desktopCookies = await desktop.cookies();
    await mobile.addCookies(desktopCookies);
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
    await desktop.close();
    await browser.close();
  } catch (err) {
    console.error('Error: ' + err.message);
    try {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages[0]) await pages[0].screenshot({ path: 'debug.png', fullPage: true });
    } catch (e) {}
    await browser.close();
    process.exit(1);
  }
}

run();
