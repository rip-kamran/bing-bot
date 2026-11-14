const { chromium } = require('playwright');
const fs = require('fs');

const EMAIL    = process.env.MS_EMAIL    || '';
const PASSWORD = process.env.MS_PASSWORD || '';
const COOKIE_FILE = '/tmp/ms_cookies.json';

const SEARCHES = [
  'weather forecast today', 'latest news headlines', 'best movies 2024',
  'how to learn guitar', 'healthy dinner recipes', 'space exploration news',
  'football scores today', 'crypto market update', 'cheap travel deals',
  'python programming tips', 'car review 2024', 'stock market today',
  'diy home projects', 'top music charts', 'gaming news 2024',
  'interesting history facts', 'new tech gadgets', 'workout routines',
  'easy cooking techniques', 'photography tips beginners',
  'gardening for beginners', 'astronomy latest discoveries',
  'abstract art tutorials', 'sports highlights today', 'book recommendations fiction',
  'science breakthroughs 2024', 'home decor trends', 'language learning apps',
  'random fun facts', 'movie reviews 2024', 'best hiking trails',
  'meditation techniques beginners', 'financial investing tips',
  'ocean wildlife facts', 'climate change news', 'AI technology news',
  'vintage fashion trends', 'mental health tips', 'dog training guide',
  'cat behaviour explained'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd   = (lo, hi) => lo + Math.random() * (hi - lo);

async function dump(page, label) {
  const url  = page.url();
  const text = ((await page.locator('body').innerText().catch(() => '')) || '')
    .replace(/\s+/g, ' ').slice(0, 400);
  console.log(`[${label}] ${url}`);
  console.log(`[${label}] ${text || '(empty)'}`);
  await page.screenshot({ path: 'debug.png', fullPage: true }).catch(() => {});
}

async function clickFirst(page, sel, timeout = 15000) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout });
  await loc.click();
}

async function tryClick(page, sel, timeout = 2500) {
  try { await clickFirst(page, sel, timeout); return true; }
  catch { return false; }
}

async function fillFirst(page, sel, value, timeout = 20000) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout });
  await loc.click();
  await loc.fill('');
  await loc.fill(value);
}

function isLoginUrl(url) {
  return /login\.live\.com|login\.microsoftonline\.com|account\.live\.com|signup\.live/i.test(url);
}

async function saveCookies(context) {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies()));
    console.log('Cookies saved.');
  } catch {}
}

async function loadCookies(context) {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return false;
    const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) return false;
    await context.addCookies(raw);
    console.log(`Loaded ${raw.length} cookies.`);
    return true;
  } catch { return false; }
}

async function isSignedIn(page) {
  await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  const url  = page.url();
  const text = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  return !isLoginUrl(url) && !/sign in/i.test(text.slice(0, 200));
}

async function login(page) {
  if (!EMAIL || !PASSWORD) throw new Error('MS_EMAIL / MS_PASSWORD secrets missing.');

  // Go straight to the Microsoft login page — avoids Bing's MSPPError region wall
  console.log('Navigating to Microsoft login...');
  await page.goto(
    'https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=162&wp=MBI_SSL&wreply=' +
      encodeURIComponent('https://www.bing.com/') + '&id=264960',
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );
  await sleep(3000);

  const emailSel = 'input[name="loginfmt"], input[type="email"], input[name="username"]';
  // retry once if email field not visible (sometimes needs a second load)
  let emailVisible = await page.locator(emailSel).first().isVisible().catch(() => false);
  if (!emailVisible) {
    console.log('Email field not found on first load — retrying login URL...');
    await page.goto(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=9ea1ad79-fdb6-4f9a-8bc3-2b70f96e34c7&response_type=code&redirect_uri=' +
        encodeURIComponent('https://www.bing.com/') + '&scope=openid+profile',
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    await sleep(3000);
  }

  await fillFirst(page, emailSel, EMAIL, 25000);
  await tryClick(page, '#idSIButtonNext, input[type="submit"], button[type="submit"]', 8000);
  await sleep(4000);

  await tryClick(page, 'a#idA_PWD_SwitchToPassword, text=Use your password, text=Sign in with a password', 4000);
  await sleep(1500);

  const passLoc = page.locator('input[name="passwd"], input[type="password"]').first();
  if (await passLoc.isVisible().catch(() => false)) {
    await passLoc.fill(PASSWORD);
    await tryClick(page, '#idSIButtonNext, input[type="submit"], button[type="submit"]', 8000);
    await sleep(3000);
  }

  await tryClick(page, '#idSIButtonNext, #acceptButton, input[value="Yes"]', 4000);

  console.log('>>> APPROVE SIGN-IN IN MICROSOFT AUTHENTICATOR. Waiting 3 minutes...');
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await tryClick(page, '#idSIButtonNext, #acceptButton, input[value="Yes"]', 800);
    const url  = page.url();
    const text = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    if (!isLoginUrl(url)) { console.log('Left login — signed in.'); break; }
    if (/incorrect|wrong password|doesn.t exist|couldn.t find/i.test(text))
      throw new Error('Microsoft rejected credentials: ' + text.slice(0, 200));
    await sleep(8000);
  }

  await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  if (isLoginUrl(page.url())) throw new Error('Still not signed in after 2FA wait.');
  console.log('Signed in.');
}

async function doSearches(page, label, count, offset) {
  let credited = 0;
  for (let i = 0; i < count; i++) {
    const term = SEARCHES[(i + offset) % SEARCHES.length];
    try {
      await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(term), {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      credited++;
      console.log(`${label} ${credited}/${count}: ${term}`);
    } catch (e) {
      console.warn(`${label} search ${i + 1} failed (${e.message.slice(0, 60)}) — skipping`);
    }
    await sleep(rnd(3500, 5500));
  }
  console.log(`${label} done: ${credited}/${count} credited`);
}

async function doDailySet(page) {
  console.log('Checking Daily Set...');
  await page.goto('https://rewards.bing.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);

  const cardSels = [
    '[data-bi-id*="daily-set"]',
    'mee-card-group .c-card',
    '.ds-card',
    '[class*="DailySet"] [class*="card"]',
    '[class*="offer-card"]',
  ];

  for (const sel of cardSels) {
    const tiles = page.locator(sel);
    const n = await tiles.count().catch(() => 0);
    if (n === 0) continue;

    console.log(`Found ${n} tiles via "${sel}"`);
    for (let i = 0; i < Math.min(n, 6); i++) {
      try {
        const [newPage] = await Promise.all([
          page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null),
          tiles.nth(i).click({ timeout: 3000 }),
        ]);
        if (newPage) {
          await newPage.waitForLoadState('domcontentloaded').catch(() => {});
          await sleep(4000);
          await newPage.close().catch(() => {});
        } else {
          await sleep(4000);
          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await sleep(2000);
        }
      } catch {}
    }
    break;
  }
  console.log('Daily Set done.');
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport:  { width: 1280, height: 800 },
    locale:    'en-US',
    timezoneId: 'America/New_York',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    const loaded   = await loadCookies(context);
    let alreadyIn  = false;
    if (loaded) {
      alreadyIn = await isSignedIn(page);
      console.log(alreadyIn ? 'Cookie login OK — skipping 2FA.' : 'Cookies expired — full login.');
    }
    if (!alreadyIn) {
      await login(page);
      await saveCookies(context);
    }

    console.log('Desktop searches...');
    await doSearches(page, 'Desktop', 35, 0);

    console.log('Mobile searches...');
    const mobileCtx = await browser.newContext({
      userAgent:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport:   { width: 390, height: 844 },
      isMobile:   true,
      hasTouch:   true,
      locale:     'en-US',
      timezoneId: 'America/New_York',
    });
    await mobileCtx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await mobileCtx.addCookies(await context.cookies());
    const mobilePage = await mobileCtx.newPage();
    await doSearches(mobilePage, 'Mobile', 25, 5);
    await mobileCtx.close();

    await doDailySet(page);

    console.log('All done.');
    await saveCookies(context);
    await browser.close();
  } catch (err) {
    console.error('Fatal: ' + err.message);
    await dump(page, 'error').catch(() => {});
    await browser.close();
    process.exit(1);
  }
}

run();
