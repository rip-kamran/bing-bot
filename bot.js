const { chromium } = require('playwright');

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
  if (!trimmed) {
    throw new Error('MS_COOKIES secret is empty. Add it in repo Settings → Secrets → Actions.');
  }

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
    if (!Array.isArray(arr) || !arr.length) {
      throw new Error('MS_COOKIES JSON did not contain any cookies.');
    }
    return arr.filter((c) => c && c.name && c.value != null).map(toCookie);
  }

  if (!trimmed.includes(';') && !trimmed.includes('=')) {
    return [{ name: '_U', value: trimmed, domain: '.bing.com', path: '/', secure: true }];
  }

  if (!trimmed.includes(';') && !/_U=/i.test(trimmed) && !trimmed.includes(' ')) {
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

async function assertLoggedIn(page) {
  await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const url = page.url();
  if (/login|signin|oauth|live\.com/i.test(url)) {
    throw new Error('Cookie is invalid or expired — Microsoft sent us to login. Refresh MS_COOKIES.');
  }
  const body = ((await page.textContent('body').catch(() => '')) || '').toLowerCase();
  if (body.includes('sign in') && !body.includes('points')) {
    throw new Error('Not signed in. Refresh MS_COOKIES from a logged-in bing.com tab.');
  }
  console.log('Logged in via cookies.');
}

async function doSearches(page, label, count, offset) {
  for (let i = 0; i < count; i++) {
    let term = SEARCHES[(i + offset) % SEARCHES.length];
    term += ' ' + (Date.now() % 10000);
    await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(term), {
      waitUntil: 'domcontentloaded',
    });
    console.log(label + ' ' + (i + 1) + '/' + count + ': ' + term);
    await sleep(6000 + Math.random() * 4000);
  }
}

async function run() {
  const cookies = parseCookies(COOKIES_RAW);
  console.log('Loaded ' + cookies.length + ' cookie(s).');

  const browser = await chromium.launch({ headless: true });

  try {
    const desktop = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    await desktop.addCookies(cookies);
    const page = await desktop.newPage();

    await assertLoggedIn(page);

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
    await mobile.addCookies(cookies);
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
    await desktop.close();
  } catch (err) {
    console.error('Error: ' + err.message);
    try {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages[0]) await pages[0].screenshot({ path: 'debug.png', fullPage: true });
    } catch (e) {}
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

run();
