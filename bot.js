const { chromium } = require('playwright');

const EMAIL = process.env.MS_EMAIL;
const PASSWORD = process.env.MS_PASSWORD;

const SEARCHES = [
  'weather', 'news', 'sports', 'music', 'movies', 'games',
  'food', 'travel', 'animals', 'space', 'coding', 'history',
  'science', 'fitness', 'shopping', 'cars', 'art', 'ocean',
  'plants', 'stars', 'dogs', 'cats', 'math', 'school',
  'fashion', 'jobs', 'money', 'health', 'funny', 'sleep'
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Login
    console.log('Logging in...');
    await page.goto('https://login.live.com/');
    await sleep(3000);
    await page.fill('input[type="email"]', EMAIL);
    await page.click('input[type="submit"]');
    await sleep(4000);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('input[type="submit"]');
    await sleep(6000);

    // Stay signed in
    try { await page.click('text=Yes'); await sleep(2000); } catch(e) {}

    // Desktop searches (30)
    console.log('Starting desktop searches...');
    for (let i = 0; i < 30; i++) {
      let term = SEARCHES[i % SEARCHES.length];
      if (i >= SEARCHES.length) term += ' ' + i;
      await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(term));
      console.log('Desktop ' + (i+1) + '/30: ' + term);
      await sleep(6000 + Math.random() * 4000);
    }

    // Mobile searches (20) - spoof mobile user-agent
    console.log('Mobile searches...');
    await page.context().addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      });
    });
    for (let i = 0; i < 20; i++) {
      let term = SEARCHES[(i + 15) % SEARCHES.length];
      await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(term));
      console.log('Mobile ' + (i+1) + '/20: ' + term);
      await sleep(7000 + Math.random() * 5000);
    }

    // Daily Set - try to click tiles
    console.log('Checking Daily Set...');
    await page.goto('https://rewards.bing.com/');
    await sleep(6000);
    try {
      let tiles = await page.$$('[class*="offer-"], [class*="card"], [class*="tile"]');
      for (let t of tiles.slice(0, 3)) {
        try {
          await t.click();
          await sleep(8000);
          await page.goBack();
          await sleep(3000);
        } catch(e){}
      }
    } catch(e) {
      console.log('No daily tiles found');
    }

    console.log('All done!');
  } catch(err) {
    console.error('Error: ' + err.message);
  }
  await browser.close();
}

run();
