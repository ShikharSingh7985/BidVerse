import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client.js';
import { paths } from '../paths.js';
import AuctionsPage from './AuctionsPage.jsx';

const auctions = [
  {
    id: 41,
    name: 'North Terminal Freight',
    reference_id: 'RFQ-NORTH',
    currency: 'USD',
    lowest_bid: '1280.50',
    current_close_at: '2030-07-01T12:30:00Z',
    forced_close_at: '2030-07-01T13:00:00Z',
    status: 'active',
  },
  {
    id: 42,
    name: 'Cold Storage',
    reference_id: 'RFQ-CHILL',
    currency: 'USD',
    lowest_bid: null,
    current_close_at: '2030-07-02T12:30:00Z',
    forced_close_at: '2030-07-02T13:00:00Z',
    status: 'upcoming',
  },
  {
    id: 43,
    name: 'Zero Cost Shuttle',
    reference_id: 'RFQ-ZERO',
    currency: 'USD',
    lowest_bid: '0.00',
    current_close_at: '2030-06-28T10:30:00Z',
    forced_close_at: '2030-06-28T11:00:00Z',
    status: 'force_closed',
  },
];

let queryClient;

function DetailRoute() {
  const { rfqId } = useParams();
  return <h1>Details for RFQ {rfqId}</h1>;
}

function renderListing() {
  queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[paths.auctions]}>
        <Routes>
          <Route path={paths.auctions} element={<AuctionsPage />} />
          <Route path={paths.auctionDetails} element={<DetailRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function formatUsd(amount) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: 'USD', currencyDisplay: 'code',
  }).format(amount).replace(/\s+/g, ' ');
}

afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.restoreAllMocks();
});

describe('auction listing', () => {
  it('loads auctions and distinguishes zero bids from no valid bids', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: auctions });
    renderListing();
    const table = await screen.findByRole('table');
    expect(get).toHaveBeenCalledWith('/rfqs', {
      params: { auction_only: true },
      signal: expect.any(AbortSignal),
    });
    for (const heading of ['RFQ name', 'Lowest bid', 'Current close', 'Forced close', 'Status']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeTruthy();
    }
    const row = within(table).getByRole('row', { name: /North Terminal Freight/ });
    expect(within(row).getByText(formatUsd(1280.50))).toBeTruthy();
    expect(within(row).getByText('Active')).toBeTruthy();
    expect([...row.querySelectorAll('time')].map((time) => time.dateTime)).toEqual([
      auctions[0].current_close_at, auctions[0].forced_close_at,
    ]);
    expect(within(table).getByText('No valid bids')).toBeTruthy();
    expect(within(table).getByText(formatUsd(0))).toBeTruthy();
  });

  it('combines search and status filters and clears them together', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: auctions });
    renderListing();
    await screen.findByRole('link', { name: 'North Terminal Freight' });
    const search = screen.getByRole('searchbox', { name: 'Search auctions' });
    const status = screen.getByRole('combobox', { name: 'Filter by status' });
    fireEvent.change(search, { target: { value: '  north TERMINAL ' } });
    expect(screen.getByRole('link', { name: 'North Terminal Freight' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cold Storage' })).toBeNull();

    fireEvent.change(search, { target: { value: 'RFQ-chill' } });
    expect(screen.getByRole('link', { name: 'Cold Storage' })).toBeTruthy();
    fireEvent.change(status, { target: { value: 'active' } });
    expect(screen.getByRole('heading', { name: 'No auctions match your filters' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(search.value).toBe('');
    expect(status.value).toBe('all');
    expect(screen.getByRole('link', { name: 'North Terminal Freight' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cold Storage' })).toBeTruthy();
  });

  it('opens the selected auction details', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: auctions });
    renderListing();
    fireEvent.click(await screen.findByRole('link', { name: 'Cold Storage' }));
    expect(await screen.findByRole('heading', { name: 'Details for RFQ 42' })).toBeTruthy();
  });

  it('shows loading and a distinct empty state', async () => {
    let complete;
    const pending = new Promise((resolve) => { complete = resolve; });
    vi.spyOn(apiClient, 'get').mockReturnValue(pending);
    renderListing();
    expect(screen.getByRole('status').textContent).toBe('Loading auctions…');
    complete({ data: [] });
    expect(await screen.findByRole('heading', { name: 'No auctions yet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an RFQ' }).getAttribute('href')).toBe(paths.createRfq);
  });

  it('shows a request error and retries on demand', async () => {
    const get = vi.spyOn(apiClient, 'get')
      .mockRejectedValueOnce(new Error('Request failed'))
      .mockResolvedValueOnce({ data: auctions });
    renderListing();
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load auctions');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps the last results visible when a refresh fails', async () => {
    vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ data: auctions })
      .mockRejectedValueOnce(new Error('Refresh failed'));
    renderListing();
    await screen.findByRole('table');
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['rfqs', 'auctions'] });
    });
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t refresh auctions');
    expect(screen.getByRole('link', { name: 'North Terminal Freight' })).toBeTruthy();
  });
});
