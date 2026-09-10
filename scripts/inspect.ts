import { chromium } from 'playwright';
import fs from 'fs';

async function inspectApp() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  
  const page = await context.newPage();
  
  const consoleLogs: string[] = [];
  const errors: string[] = [];
  
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  
  console.log('--- 1. Navigating to localhost:3000 ---');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for initial WebSocket / data to kick in
  console.log('--- 2. Waiting 5s for live Binance data stream ---');
  await page.waitForTimeout(5000);
  
  // Collect Dashboard Info
  const dashboardInfo = await page.evaluate(() => {
    const symbolEl = document.querySelector('header span')?.textContent;
    const priceEl = document.querySelector('header h1')?.textContent;
    const cards = Array.from(document.querySelectorAll('div')).filter(d => d.textContent?.includes('tx') && (d.textContent?.includes('Karides') || d.textContent?.includes('Balina')));
    const trades = Array.from(document.querySelectorAll('div')).filter(d => d.textContent?.includes('$') && (d.textContent?.includes('ALIŞ') || d.textContent?.includes('SATIŞ')));
    return {
      title: document.title,
      symbol: symbolEl,
      price: priceEl,
      bucketCount: cards.length,
      sampleCardText: cards[0]?.textContent?.slice(0, 100),
      tradesCount: trades.length,
    };
  });
  console.log('Dashboard Evaluation:', JSON.stringify(dashboardInfo, null, 2));

  // Check tabs
  const tabNames = ['Grafik', 'Kovalar', 'İstatistik', 'Terminal', 'Ayarlar', 'Dashboard'];
  const tabResults: Record<string, any> = {};

  for (const tab of tabNames) {
    console.log(`--- Checking Tab: ${tab} ---`);
    const tabBtn = page.getByRole('button', { name: tab });
    if (await tabBtn.count() > 0) {
      await tabBtn.first().click();
      await page.waitForTimeout(2000);
      const contentSample = await page.evaluate(() => document.body.innerText.slice(0, 300));
      tabResults[tab] = {
        clicked: true,
        preview: contentSample.replace(/\n+/g, ' ')
      };
    } else {
      tabResults[tab] = { clicked: false, error: 'Button not found' };
    }
  }

  console.log('Tabs Evaluation:', JSON.stringify(tabResults, null, 2));
  console.log('Console Errors:', errors);
  console.log('Console Logs (last 10):', consoleLogs.slice(-10));

  await browser.close();
}

inspectApp().catch(err => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
