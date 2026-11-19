import { expect } from '@playwright/test';
import { test } from './demoFixture.js';

const minute = 60_000;
const day = 24 * 60 * minute;
const rfqName = 'Demo coastal freight';
const localMinute = (time) => new Date(time).toISOString().slice(0, 16);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'code' });

async function createRfq(page, start) {
  await page.getByRole('link', { name: 'New RFQ' }).click();
  await page.getByLabel('RFQ name').fill(rfqName);
  await page.getByLabel('Reference ID').fill('E2E-COASTAL-FREIGHT');
  await page.getByLabel('Buyer', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Currency').fill('USD');
  await page.getByLabel('Bid start time').fill(localMinute(start - 2 * minute));
  await page.getByLabel('Initial close time').fill(localMinute(start + 3 * minute));
  await page.getByLabel('Forced close time').fill(localMinute(start + 9 * minute));
  await page.getByLabel('Service date').fill(localMinute(start + 7 * day).slice(0, 10));
  await page.getByLabel('Extension trigger').selectOption('supplier_rank_changed');
  await page.getByLabel('Trigger window (X minutes)').fill('15');
  await page.getByLabel('Extension duration (Y minutes)').fill('4');

  const creation = page.waitForResponse((response) => (
    response.url().endsWith('/api/rfqs') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Create RFQ' }).click();
  const response = await creation;
  expect(response.status()).toBe(201);
  await expect(page.getByRole('heading', { name: rfqName })).toBeVisible();
  return response.json();
}

async function submitQuote(page, { supplier, carrier, freight, validUntil }) {
  await page.getByLabel('Supplier', { exact: true }).selectOption({ index: supplier });
  await page.getByLabel('Carrier name').fill(carrier);
  await page.getByLabel('Transit time (days)').fill('3');
  await page.getByLabel('Freight charges').fill(String(freight));
  await page.getByLabel('Origin charges').fill('7.50');
  await page.getByLabel('Destination charges').fill('2.50');
  await page.getByLabel('Quote valid until').fill(validUntil);
  await expect(page.getByLabel('Calculated total')).toHaveText(usd.format(freight + 10));

  const submission = page.waitForResponse((response) => (
    response.url().endsWith('/bids') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Submit quote' }).click();
  const response = await submission;
  expect(response.status()).toBe(201);
  const bid = await response.json();
  await expect(page.getByText(`Quote submitted successfully as bid #${bid.id}.`)).toBeVisible();
  return bid;
}

test('two browser sessions see bid revisions, extensions and the forced close', async ({ browser, demo, request }) => {
  const buyerContext = await browser.newContext({ timezoneId: 'UTC', locale: 'en-US' });
  try {
    const observerContext = await browser.newContext({
      timezoneId: 'UTC', locale: 'en-US', viewport: { width: 320, height: 720 },
    });
    try {
      const buyer = await buyerContext.newPage();
      const observer = await observerContext.newPage();
      const start = Date.parse(demo.now);
      await observer.clock.install({ time: start });
      const updates = [];
      observer.on('websocket', (websocket) => {
        if (websocket.url().endsWith('/ws')) {
          websocket.on('framereceived', ({ payload }) => {
            const message = JSON.parse(payload.toString());
            if (message.type === 'auction_updated') updates.push(message);
          });
        }
      });

      await buyer.goto(demo.origin);
      const rfq = await createRfq(buyer, start);
      const apiRfq = `${demo.origin}/api/rfqs/${rfq.id}`;
      await observer.goto(demo.origin);
      await observer.getByRole('link', { name: rfqName }).click();
      await expect(observer.getByText('Live updates', { exact: true })).toBeVisible();
      await expect(observer.getByRole('timer')).toBeVisible();

      const rankings = observer.getByRole('region', { name: 'Supplier rankings' }).getByRole('listitem');
      const history = observer.getByRole('region', { name: 'Bid history' });
      const activity = observer.getByRole('region', { name: 'Activity log' });
      const currentClose = observer.getByRole('heading', { name: 'Current close' }).locator('..').locator('time');
      const originalClose = rfq.original_close_at;
      const firstClose = new Date(Date.parse(originalClose) + 4 * minute).toISOString().replace('.000Z', 'Z');
      const validUntil = localMinute(start + day);

      for (const quote of [
        { supplier: 1, carrier: 'Atlas original', freight: 190 },
        { supplier: 2, carrier: 'Beacon original', freight: 240 },
        { supplier: 3, carrier: 'Cedar original', freight: 9_999_999_989 },
      ]) {
        await submitQuote(buyer, { ...quote, validUntil });
      }
      await expect(rankings).toHaveCount(3);
      await expect(rankings.nth(0)).toContainText('Atlas original');
      await expect(rankings.nth(1)).toContainText('Beacon original');
      await expect(rankings.nth(2)).toContainText('Cedar original');
      await expect(rankings.nth(2)).toContainText('USD 9,999,999,999.00');
      expect(await observer.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
      await expect(currentClose).toHaveAttribute('datetime', originalClose);

      const cedar = await submitQuote(buyer, { supplier: 3, carrier: 'Cedar revised', freight: 215, validUntil });
      await expect.poll(() => updates.find((message) => message.bid_id === cedar.id)?.events)
        .toEqual(['bid_submitted', 'time_extended']);
      await expect(rankings.nth(0)).toContainText('Atlas original');
      await expect(rankings.nth(1)).toContainText('Cedar revised');
      await expect(rankings.nth(2)).toContainText('Beacon original');
      await expect(currentClose).toHaveAttribute('datetime', firstClose);

      const beacon = await submitQuote(buyer, { supplier: 2, carrier: 'Beacon revised', freight: 170, validUntil });
      await expect.poll(() => updates.find((message) => message.bid_id === beacon.id)?.events)
        .toEqual(['bid_submitted', 'time_extended']);
      await expect(rankings.nth(0)).toContainText('Beacon revised');
      await expect(rankings.nth(1)).toContainText('Atlas original');
      await expect(rankings.nth(2)).toContainText('Cedar revised');
      await expect(history.getByRole('listitem')).toHaveCount(5);
      const revisedQuote = history.getByRole('listitem').filter({ hasText: 'Beacon revised' });
      await revisedQuote.getByText('Beacon revised', { exact: true }).click();
      await expect(revisedQuote.getByText('USD 7.50')).toBeVisible();
      await expect(activity.getByText('Bid submitted', { exact: true })).toHaveCount(5);
      await expect(activity.getByText('Any supplier rank change', { exact: true })).toHaveCount(2);
      await expect(currentClose).toHaveAttribute('datetime', rfq.forced_close_at);

      const eventsResponse = await request.get(`${apiRfq}/activity`);
      await expect(eventsResponse).toBeOK();
      const events = await eventsResponse.json();
      expect(events.filter((event) => event.event_type === 'time_extended')).toEqual([
        expect.objectContaining({ bid_id: cedar.id, previous_close_at: originalClose, new_close_at: firstClose }),
        expect.objectContaining({ bid_id: beacon.id, previous_close_at: firstClose, new_close_at: rfq.forced_close_at }),
      ]);

      const clockChange = await request.post(`${demo.api}/__e2e/clock`, { data: { now: rfq.forced_close_at } });
      await expect(clockChange).toBeOK();
      await observer.clock.setSystemTime(Date.parse(rfq.forced_close_at) + 1000);
      await observer.clock.runFor(1000);
      await expect(observer.getByText('Force closed', { exact: true })).toBeVisible();
      await expect(observer.getByText('Forced close reached', { exact: true })).toBeVisible();
      await expect(observer.getByRole('button', { name: 'Submit quote' })).toBeDisabled();

      const rejected = await request.post(`${apiRfq}/bids`, { data: {
        supplier_id: beacon.supplier_id,
        carrier_name: 'Late quote',
        freight_charge: '100',
        origin_charge: '0',
        destination_charge: '0',
        transit_time_days: 3,
        valid_until: `${validUntil}:00Z`,
      } });
      expect(rejected.status()).toBe(409);
      const historyResponse = await request.get(`${apiRfq}/bids`);
      await expect(historyResponse).toBeOK();
      expect(await historyResponse.json()).toHaveLength(5);

      await observer.goto(`${demo.origin}/auctions`);
      const listing = observer.getByRole('row').filter({ hasText: rfqName });
      await expect(listing).toContainText('USD 180.00');
      await expect(listing).toContainText('Force closed');
      expect(await observer.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    } finally {
      await observerContext.close();
    }
  } finally {
    await buyerContext.close();
  }
});
