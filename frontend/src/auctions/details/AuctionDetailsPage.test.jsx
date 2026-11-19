import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../api/client.js';
import { auctionRefreshInterval } from '../../api/rfqs.js';
import { paths } from '../../paths.js';
import AuctionDetailsPage from './AuctionDetailsPage.jsx';

const now = Date.parse('2031-08-18T12:00:00Z');
const rfq = {
  id: 41,
  name: 'Airport freight',
  reference_id: 'RFQ-AIR',
  buyer_id: 5,
  currency: 'USD',
  created_at: '2031-08-10T10:00:00Z',
  service_date: '2031-08-19',
  bid_start_at: '2031-08-18T11:30:00Z',
  original_close_at: '2031-08-18T12:00:20Z',
  current_close_at: '2031-08-18T12:00:30Z',
  forced_close_at: '2031-08-18T12:30:00Z',
  status: 'active',
  auction_configuration: {
    trigger_window_minutes: 10,
    extension_minutes: 5,
    extension_trigger: 'supplier_rank_changed',
  },
};
const bid = {
  id: 12,
  rfq_id: 41,
  supplier_id: 6,
  carrier_name: 'Acme Air Cargo',
  freight_charge: '120.10',
  origin_charge: '4.20',
  destination_charge: '8.70',
  total_price: '133.00',
  transit_time_days: 2,
  valid_until: '2031-08-20T10:00:00Z',
  submitted_at: '2031-08-18T11:59:45Z',
};
const rankings = [
  { rank: 'L1', bid_id: 12, supplier_id: 6, carrier_name: bid.carrier_name, total_price: bid.total_price },
  { rank: 'L2', bid_id: 10, supplier_id: 7, carrier_name: 'Express Cargo', total_price: '170.00' },
  { rank: 'L3', bid_id: 9, supplier_id: 8, carrier_name: 'Regional Freight', total_price: '182.50' },
];
const activity = [
  { id: 20, event_type: 'bid_submitted', bid_id: 12, occurred_at: bid.submitted_at },
  {
    id: 21,
    event_type: 'time_extended',
    bid_id: 12,
    occurred_at: bid.submitted_at,
    extension_trigger: 'supplier_rank_changed',
    previous_close_at: rfq.original_close_at,
    new_close_at: rfq.current_close_at,
  },
];
const defaultResponses = {
  '/rfqs/41': { data: rfq, headers: { date: new Date(now).toUTCString() } },
  '/rfqs/41/rankings': { data: rankings },
  '/rfqs/41/bids': { data: [bid] },
  '/rfqs/41/activity': { data: activity },
  '/suppliers': { data: [{ id: 6, name: 'Supplier Six' }] },
};
let queryClient;

class FakeWebSocket extends EventTarget {
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }

  open() {
    this.dispatchEvent(new Event('open'));
  }

  message(data) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

function renderDetails(id = 41, state) {
  queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/auctions/' + id, state }]}>
        <Routes>
          <Route path={paths.auctionDetails} element={<AuctionDetailsPage />} />
          <Route path={paths.auctions} element={<h1>Auctions</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function changeQuote(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function fillQuote() {
  await screen.findByRole('option', { name: 'Supplier Six (#6)' });
  changeQuote('Supplier', '6');
  changeQuote('Carrier name', ' New Cargo ');
  changeQuote('Freight charges', '85.00');
  changeQuote('Origin charges', '40.00');
  changeQuote('Destination charges', '2.50');
  changeQuote('Transit time (days)', '2');
  changeQuote('Quote valid until', '2031-08-20T10:00');
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', undefined);
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('shows RFQ timing and settings, supplier ranks, expandable quotes, and extension activity', async () => {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => defaultResponses[url]);
  renderDetails(41, { createdRfq: { id: 41, name: rfq.name } });
  expect(await screen.findByRole('heading', { name: rfq.name })).toBeTruthy();
  expect(screen.getByText('was created successfully.', { exact: false })).toBeTruthy();
  expect(screen.getByText('RFQ-AIR')).toBeTruthy();
  expect(screen.getByText('Active')).toBeTruthy();
  expect(screen.getByRole('timer')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Current close' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Forced close' })).toBeTruthy();
  const info = screen.getByRole('region', { name: 'RFQ information' });
  expect(info.querySelector('time[datetime="2031-08-19"]')).toBeTruthy();
  expect(within(info).getByText('#5')).toBeTruthy();
  const config = within(screen.getByRole('region', { name: 'Auction configuration' }));
  expect(config.getByText('10 min')).toBeTruthy();
  expect(config.getByText('5 min')).toBeTruthy();
  expect(config.getByText('Any supplier rank change')).toBeTruthy();

  const ranks = within(screen.getByRole('region', { name: 'Supplier rankings' }));
  for (const rank of ['L1', 'L2', 'L3']) expect(await ranks.findByText(rank)).toBeTruthy();
  const history = screen.getByRole('region', { name: 'Bid history' });
  fireEvent.click((await within(history).findByText(bid.carrier_name)).closest('summary'));
  expect(history.querySelector('details').open).toBe(true);
  for (const label of ['Freight charge', 'Origin charge', 'Destination charge', '2 days', 'Quote valid until']) {
    expect(within(history).getByText(label)).toBeTruthy();
  }

  const log = within(screen.getByRole('region', { name: 'Activity log' }));
  const entries = await log.findAllByRole('listitem');
  expect(entries[0].textContent).toContain('Bid submitted');
  expect(entries[1].textContent).toContain('Deadline extended');
  expect(within(entries[1]).getByText('Any supplier rank change')).toBeTruthy();
  expect([...entries[1].querySelectorAll('time')].map((time) => time.dateTime)).toEqual([
    activity[1].occurred_at, rfq.original_close_at, rfq.current_close_at,
  ]);
});

it('shows a loading state and then distinct empty states for a fixed-deadline RFQ', async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  vi.spyOn(apiClient, 'get').mockImplementation((url) => url === '/rfqs/41' ? pending : Promise.resolve({ data: [] }));
  renderDetails();
  expect(screen.getByRole('status').textContent).toBe('Loading auction details…');
  await act(async () => complete({ data: { ...rfq, status: 'closed', auction_configuration: null } }));
  expect(await screen.findByText('No currently valid bids to rank.')).toBeTruthy();
  expect(screen.getByText('No bids have been submitted.')).toBeTruthy();
  expect(screen.getByText('No auction activity yet.')).toBeTruthy();
  expect(screen.getByText('This RFQ uses a fixed deadline. Extension settings apply to British Auctions.')).toBeTruthy();
  expect(screen.getByText('Bidding closed')).toBeTruthy();
  expect(screen.queryByRole('timer')).toBeNull();
  expect(screen.getByRole('button', { name: 'Submit quote' }).disabled).toBe(true);
});

it('keeps available panels visible and retries an individual request', async () => {
  let attempts = 0;
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (url === '/rfqs/41/rankings' && attempts++ === 0) throw new Error('Rankings unavailable');
    return defaultResponses[url];
  });
  renderDetails();
  expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load supplier rankings');
  expect(await screen.findByText('Deadline extended')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('L1')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retries a failed RFQ request', async () => {
  const get = vi.spyOn(apiClient, 'get')
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockImplementation(async (url) => defaultResponses[url]);
  renderDetails();
  expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load auction details.');
  expect(get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: rfq.name })).toBeTruthy();
});

it('handles invalid IDs without requests and can return to the auction list', () => {
  const get = vi.spyOn(apiClient, 'get');
  renderDetails('invalid');
  expect(screen.getByRole('alert').textContent).toBe('Auction not found.');
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'Back to auctions' }));
  expect(screen.getByRole('heading', { name: 'Auctions' })).toBeTruthy();
});

it('shows not found and skips related requests when the server returns 404', async () => {
  const get = vi.spyOn(apiClient, 'get').mockRejectedValue({ response: { status: 404 } });
  renderDetails(999);
  expect((await screen.findByRole('alert')).textContent).toBe('Auction not found.');
  expect(get.mock.calls.map(([url]) => url)).toEqual(['/rfqs/999']);
});

it('ticks against the server clock and polls all four resources for updates', async () => {
  vi.useFakeTimers();
  const clientTime = now + 3_600_000;
  vi.setSystemTime(clientTime);
  const extended = { ...rfq, current_close_at: '2031-08-18T12:01:00Z' };
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (url !== '/rfqs/41') return defaultResponses[url];
    const elapsed = Date.now() - clientTime;
    return {
      data: elapsed >= auctionRefreshInterval ? extended : rfq,
      headers: { date: new Date(now + elapsed).toUTCString() },
    };
  });
  renderDetails();
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(screen.getByRole('timer').textContent).toBe('00:00:30');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole('timer').textContent).toBe('00:00:29');
  await act(async () => { await vi.advanceTimersByTimeAsync(auctionRefreshInterval); });
  for (const url of Object.keys(defaultResponses).filter((url) => url.startsWith('/rfqs/'))) {
    expect(get.mock.calls.filter(([called]) => called === url)).toHaveLength(2);
  }
  expect(screen.getByRole('timer').textContent).toBe('00:00:49');
});

it('checks the server at the start and close boundaries before its next poll', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (url !== '/rfqs/41') return { data: [] };
    const elapsed = Date.now() - now;
    return {
      data: {
        ...rfq,
        bid_start_at: '2031-08-18T12:00:02Z',
        original_close_at: '2031-08-18T12:00:03Z',
        current_close_at: '2031-08-18T12:00:04Z',
        forced_close_at: '2031-08-18T12:00:04Z',
        status: elapsed < 2000 ? 'upcoming' : elapsed < 4000 ? 'active' : 'force_closed',
      },
      headers: { date: new Date(Date.now()).toUTCString() },
    };
  });
  renderDetails();
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(screen.getByRole('heading', { name: 'Bidding opens in' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit quote' }).disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2050); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(screen.getByRole('heading', { name: 'Time remaining' })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(screen.getByText('Forced close reached')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit quote' }).disabled).toBe(true);
  expect(get.mock.calls.filter(([url]) => url === '/rfqs/41')).toHaveLength(3);
});

it('rechecks a stale active response after the closing boundary', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  let checks = 0;
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (url !== '/rfqs/41') return defaultResponses[url];
    checks += 1;
    const close = '2031-08-18T12:00:02Z';
    return {
      data: { ...rfq, current_close_at: close, forced_close_at: close, status: checks < 3 ? 'active' : 'force_closed' },
      headers: { date: new Date(Date.now()).toUTCString() },
    };
  });
  renderDetails();
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(screen.getByText('Checking auction status…')).toBeTruthy();
  expect(checks).toBe(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(checks).toBe(3);
  expect(screen.getByText('Forced close reached')).toBeTruthy();
});

it('focuses the first invalid quote field in form order', async () => {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => defaultResponses[url]);
  const post = vi.spyOn(apiClient, 'post');
  renderDetails();
  await screen.findByRole('option', { name: 'Supplier Six (#6)' });
  fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Supplier')));
  expect(screen.getByText('Select an available supplier.')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('previews the total, submits once, and refreshes all auction data after acceptance', async () => {
  let accepted = false;
  const newBid = {
    ...bid, id: 13, carrier_name: 'New Cargo', freight_charge: '85.00',
    origin_charge: '40.00', destination_charge: '2.50', total_price: '127.50',
  };
  const extendedClose = '2031-08-18T12:05:30Z';
  const updatedData = {
    '/rfqs/41': { ...rfq, current_close_at: extendedClose },
    '/rfqs/41/rankings': [{ ...rankings[0], bid_id: 13, carrier_name: 'New Cargo', total_price: '127.50' }],
    '/rfqs/41/bids': [bid, newBid],
    '/rfqs/41/activity': [...activity, {
      ...activity[1], id: 22, bid_id: 13, previous_close_at: rfq.current_close_at, new_close_at: extendedClose,
    }],
  };
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => (
    accepted && Object.hasOwn(updatedData, url)
      ? { ...defaultResponses[url], data: updatedData[url] }
      : defaultResponses[url]
  ));
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const post = vi.spyOn(apiClient, 'post').mockReturnValue(pending);
  const view = renderDetails();
  await fillQuote();
  expect(screen.getByLabelText('Calculated total').textContent).toMatch(/127[.,]50/);
  expect(await screen.findByText('Deadline extended')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }));
  const saving = await screen.findByRole('button', { name: 'Submitting quote…' });
  expect(saving.disabled).toBe(true);
  fireEvent.click(saving);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/rfqs/41/bids', {
    supplier_id: 6,
    carrier_name: 'New Cargo',
    freight_charge: '85.00',
    origin_charge: '40.00',
    destination_charge: '2.50',
    transit_time_days: 2,
    valid_until: new Date('2031-08-20T10:00').toISOString(),
  });
  accepted = true;
  await act(async () => complete({ data: newBid }));
  expect(await screen.findByText('Quote submitted successfully as bid #13.')).toBeTruthy();
  const scope = (name) => within(screen.getByRole('region', { name }));
  expect(scope('Supplier rankings').getByText('New Cargo')).toBeTruthy();
  expect(scope('Bid history').getByText('New Cargo')).toBeTruthy();
  expect(scope('Activity log').getByText('Bid #13')).toBeTruthy();
  expect(view.container.querySelector(`time[datetime="${extendedClose}"]`)).toBeTruthy();
  for (const url of Object.keys(updatedData)) {
    expect(get.mock.calls.filter(([called]) => called === url)).toHaveLength(2);
  }
  expect(screen.getByLabelText('Carrier name').value).toBe(' New Cargo ');
  expect(screen.getByLabelText('Freight charges').value).toBe('');
});

it.each(['90.50', '90.51'])('blocks equal and higher revisions before posting a freight charge of %s', async (freight) => {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => defaultResponses[url]);
  const post = vi.spyOn(apiClient, 'post');
  renderDetails();
  await fillQuote();
  await screen.findByText(/Previous accepted total/);
  changeQuote('Freight charges', freight);
  fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent',
    'The new quote total must be lower than your previous accepted bid.');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Freight charges')));
  expect(post).not.toHaveBeenCalled();
  changeQuote('Destination charges', '2.48');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('refreshes the previous total and retains the quote when a concurrent revision is accepted first', async () => {
  let revised = false;
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => (
    revised && url === '/rfqs/41/bids'
      ? { data: [{ ...bid, id: 13, total_price: '120.00' }, bid] }
      : defaultResponses[url]
  ));
  const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
    revised = true;
    throw { response: { status: 422, data: { detail: { code: 'bid_total_not_lower', previous_total: '120.00' } } } };
  });
  renderDetails();
  await fillQuote();
  await screen.findByText(/Previous accepted total.*133[.,]00/);
  fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }));
  await screen.findByText(/Previous accepted total.*120[.,]00/);
  expect(await screen.findByText(/lower than your previous accepted bid/)).toBeTruthy();
  expect(screen.getByLabelText('Freight charges').value).toBe('85.00');
  expect(get.mock.calls.filter(([url]) => url === '/rfqs/41/bids')).toHaveLength(2);
  changeQuote('Freight charges', '81.00');
  fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }));
  expect(post).toHaveBeenCalledTimes(1);
});

it('keeps quote inputs after a server rejection and shows the invalid validity field', async () => {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => defaultResponses[url]);
  vi.spyOn(apiClient, 'post').mockRejectedValue({
    response: { status: 422, data: { detail: 'valid_until must be after the server submission time' } },
  });
  renderDetails();
  await fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }));
  expect(await screen.findByText('Quote validity must be in the future.')).toBeTruthy();
  const validity = screen.getByLabelText('Quote valid until');
  await waitFor(() => expect(document.activeElement).toBe(validity));
  expect(validity.getAttribute('aria-describedby').split(' ')).toHaveLength(2);
  expect(screen.getByLabelText('Freight charges').value).toBe('85.00');
  expect(screen.getByRole('button', { name: 'Submit quote' }).disabled).toBe(false);
});

it('refreshes the auction and disables bidding when submission races with closure', async () => {
  let rejected = false;
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => (
    rejected && url === '/rfqs/41'
      ? { ...defaultResponses[url], data: { ...rfq, status: 'closed' } }
      : defaultResponses[url]
  ));
  vi.spyOn(apiClient, 'post').mockImplementation(async () => {
    rejected = true;
    throw { response: { status: 409 } };
  });
  renderDetails();
  await fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Submit quote' }));
  expect(await screen.findByText(/This auction is no longer accepting bids/)).toBeTruthy();
  expect(await screen.findByText('Bidding is closed for this auction.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit quote' }).disabled).toBe(true);
});

it('blocks a quote when its deadline has passed even if the RFQ response still says active', async () => {
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => (
    url === '/rfqs/41' ? { data: rfq, headers: { date: new Date(now + 30_000).toUTCString() } } : defaultResponses[url]
  ));
  const post = vi.spyOn(apiClient, 'post');
  renderDetails();
  expect(await screen.findByText('Bidding is closed for this auction.')).toBeTruthy();
  const submit = screen.getByRole('button', { name: 'Submit quote' });
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(post).not.toHaveBeenCalled();
  expect(get.mock.calls.some(([url]) => url === '/suppliers')).toBe(false);
});

it('refreshes all RFQ queries on a WebSocket update and ignores unrelated messages', async () => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  let updated = false;
  const extendedClose = '2031-08-18T12:05:30Z';
  const updatedData = {
    '/rfqs/41': { ...rfq, current_close_at: extendedClose },
    '/rfqs/41/rankings': [{ ...rankings[0], carrier_name: 'Socket Carrier' }],
    '/rfqs/41/bids': [{ ...bid, carrier_name: 'Socket Carrier' }],
    '/rfqs/41/activity': [...activity, {
      ...activity[1], id: 22, bid_id: 13, previous_close_at: rfq.current_close_at, new_close_at: extendedClose,
    }],
  };
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => (
    updated && Object.hasOwn(updatedData, url)
      ? { ...defaultResponses[url], data: updatedData[url] }
      : defaultResponses[url]
  ));
  const view = renderDetails();
  expect(await screen.findByText('L1')).toBeTruthy();
  expect(screen.getByText('Polling for updates')).toBeTruthy();
  const [socket] = FakeWebSocket.instances;
  expect(socket.url).toMatch(/^ws:\/\/[^/]+\/api\/rfqs\/41\/ws$/);
  act(() => socket.open());
  expect(await screen.findByText('Live updates')).toBeTruthy();
  const requestCount = (url) => get.mock.calls.filter(([called]) => called === url).length;
  await waitFor(() => {
    for (const url of Object.keys(updatedData)) expect(requestCount(url)).toBe(2);
  });

  act(() => {
    socket.message('not JSON');
    socket.message(JSON.stringify({ type: 'auction_updated', rfq_id: 42 }));
    socket.message(JSON.stringify({ type: 'heartbeat', rfq_id: 41 }));
  });
  for (const url of Object.keys(updatedData)) expect(requestCount(url)).toBe(2);

  updated = true;
  act(() => socket.message(JSON.stringify({
    type: 'auction_updated', rfq_id: 41, bid_id: 13, events: ['bid_submitted', 'time_extended'],
  })));
  const panel = (name) => within(screen.getByRole('region', { name }));
  expect(await panel('Supplier rankings').findByText('Socket Carrier')).toBeTruthy();
  expect(await panel('Bid history').findByText('Socket Carrier')).toBeTruthy();
  expect(await panel('Activity log').findByText('Bid #13')).toBeTruthy();
  expect(view.container.querySelector(`time[datetime="${extendedClose}"]`)).toBeTruthy();
  for (const url of Object.keys(updatedData)) expect(requestCount(url)).toBe(3);
});

it('falls back to polling on failure and catches up when the socket reconnects', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => defaultResponses[url]);
  renderDetails();
  const advance = async (delay) => act(async () => { await vi.advanceTimersByTimeAsync(delay); });
  await advance(20);
  const [first] = FakeWebSocket.instances;
  act(() => first.open());
  await advance(20);
  expect(screen.getByText('Live updates')).toBeTruthy();

  const watchUrls = Object.keys(defaultResponses).filter((url) => url.startsWith('/rfqs/'));
  const requestCount = (url) => get.mock.calls.filter(([called]) => called === url).length;
  const before = watchUrls.map(requestCount);
  await advance(auctionRefreshInterval);
  expect(watchUrls.map(requestCount)).toEqual(before);

  act(() => first.dispatchEvent(new Event('error')));
  expect(first.closed).toBe(true);
  expect(screen.getByText('Polling for updates')).toBeTruthy();
  await advance(1000);
  expect(FakeWebSocket.instances).toHaveLength(2);
  await advance(auctionRefreshInterval - 900);
  expect(watchUrls.map(requestCount)).toEqual(before.map((count) => count + 1));

  const [, second] = FakeWebSocket.instances;
  act(() => second.open());
  await advance(20);
  expect(screen.getByText('Live updates')).toBeTruthy();
  expect(watchUrls.map(requestCount)).toEqual(before.map((count) => count + 2));

  fireEvent.click(screen.getByRole('link', { name: 'Back to auctions' }));
  expect(second.closed).toBe(true);
  await advance(60_000);
  expect(FakeWebSocket.instances).toHaveLength(2);
});

it('retries a stalled connection and uses heartbeats to detect a silent stream', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => (
    url === '/rfqs/41'
      ? { ...defaultResponses[url], data: { ...rfq, current_close_at: rfq.forced_close_at } }
      : defaultResponses[url]
  ));
  renderDetails();
  const advance = async (delay) => act(async () => { await vi.advanceTimersByTimeAsync(delay); });
  await advance(20);
  const [stalled] = FakeWebSocket.instances;
  await advance(10_000);
  expect(stalled.closed).toBe(true);
  await advance(1000);
  const [, live] = FakeWebSocket.instances;
  act(() => live.open());
  await advance(35_000);
  act(() => live.message(JSON.stringify({ type: 'heartbeat', rfq_id: 41 })));
  await advance(20_000);
  expect(screen.getByText('Live updates')).toBeTruthy();
  await advance(25_000);
  expect(live.closed).toBe(true);
  expect(screen.getByText('Polling for updates')).toBeTruthy();
});
