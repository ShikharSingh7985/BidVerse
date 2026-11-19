import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client.js';
import { auctionListQueryKey } from '../api/rfqs.js';
import { paths } from '../paths.js';
import CreateRfqPage from './CreateRfqPage.jsx';

const buyers = [{ id: 8, name: 'Team Buyer' }];
let queryClient;

function DetailsRoute() {
  const { rfqId } = useParams();
  const { state } = useLocation();
  return <h1>Auction #{rfqId} · {state?.createdRfq?.name}</h1>;
}

function renderForm() {
  queryClient = new QueryClient();
  queryClient.setQueryData(auctionListQueryKey, []);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[paths.createRfq]}>
        <Routes>
          <Route path={paths.createRfq} element={<CreateRfqPage />} />
          <Route path={paths.auctionDetails} element={<DetailsRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function change(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function fillForm() {
  await screen.findByRole('option', { name: 'Team Buyer (#8)' });
  change('RFQ name', ' Airport freight ');
  change('Reference ID', 'RFQ-AIR');
  change('Buyer', '8');
  change('Currency', 'usd');
  change('Bid start time', '2031-08-18T09:00');
  change('Initial close time', '2031-08-18T10:00');
  change('Forced close time', '2031-08-18T11:00');
  change('Service date', '2031-08-19');
}

afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.restoreAllMocks();
});

it('submits only once while saving, refreshes the listing cache, and opens the created auction', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: buyers });
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const post = vi.spyOn(apiClient, 'post').mockReturnValue(pending);
  renderForm();
  await fillForm();
  change('Extension trigger', 'lowest_bidder_changed');
  change('Trigger window (X minutes)', '15');
  change('Extension duration (Y minutes)', '7');

  fireEvent.click(screen.getByRole('button', { name: 'Create RFQ' }));
  const saving = await screen.findByRole('button', { name: 'Creating RFQ…' });
  expect(saving.disabled).toBe(true);
  fireEvent.click(saving);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/rfqs', {
    name: 'Airport freight',
    reference_id: 'RFQ-AIR',
    buyer_id: 8,
    currency: 'USD',
    bid_start_at: new Date('2031-08-18T09:00').toISOString(),
    original_close_at: new Date('2031-08-18T10:00').toISOString(),
    forced_close_at: new Date('2031-08-18T11:00').toISOString(),
    service_date: '2031-08-19',
    auction_configuration: {
      extension_trigger: 'lowest_bidder_changed',
      trigger_window_minutes: 15,
      extension_minutes: 7,
    },
  });
  await act(async () => complete({ data: { id: 42, name: 'Airport freight' } }));
  expect(await screen.findByRole('heading', { name: 'Auction #42 · Airport freight' })).toBeTruthy();
  expect(queryClient.getQueryState(auctionListQueryKey).isInvalidated).toBe(true);
});

it('shows actionable errors for missing fields and invalid schedule and extension values', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: buyers });
  const post = vi.spyOn(apiClient, 'post');
  renderForm();
  await screen.findByRole('option', { name: 'Team Buyer (#8)' });
  fireEvent.click(screen.getByRole('button', { name: 'Create RFQ' }));
  expect(screen.getByText('Enter an RFQ name.')).toBeTruthy();
  expect(screen.getByLabelText('RFQ name').getAttribute('aria-invalid')).toBe('true');

  await fillForm();
  change('Initial close time', '2031-08-18T09:00');
  change('Forced close time', '2031-08-18T09:00');
  change('Extension duration (Y minutes)', '0');
  expect(screen.getByText('Initial close must be after the bid start.')).toBeTruthy();
  expect(screen.getByText('Forced close must be after the initial close.')).toBeTruthy();
  expect(screen.getByText(/Enter a whole number/)).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('keeps input after a duplicate reference and allows correction', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: buyers });
  const post = vi.spyOn(apiClient, 'post')
    .mockRejectedValueOnce({ response: { status: 409 } })
    .mockResolvedValueOnce({ data: { id: 42, name: 'Airport freight' } });
  renderForm();
  await fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Create RFQ' }));
  expect(await screen.findByText(/This reference ID is already in use/)).toBeTruthy();
  expect(screen.getByLabelText('Buyer').value).toBe('8');
  change('Reference ID', 'RFQ-AIR-2');
  expect(screen.queryByText(/This reference ID is already in use/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create RFQ' }));
  expect(await screen.findByRole('heading', { name: 'Auction #42 · Airport freight' })).toBeTruthy();
  expect(post.mock.calls[1][1].reference_id).toBe('RFQ-AIR-2');
});

it('submits a fixed-deadline RFQ with British Auction turned off', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: buyers });
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { id: 42, name: 'Airport freight' } });
  renderForm();
  await fillForm();
  fireEvent.click(screen.getByRole('switch', { name: 'Enable British Auction' }));
  expect(screen.queryByLabelText('Extension trigger')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create RFQ' }));
  expect(await screen.findByRole('heading', { name: 'Auction #42 · Airport freight' })).toBeTruthy();
  expect(post.mock.calls[0][1].auction_configuration).toBeNull();
});

it('keeps the form usable and focuses a field after a mixed validation response', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: buyers });
  vi.spyOn(apiClient, 'post').mockRejectedValue({ response: { status: 422, data: { detail: [
    null,
    { loc: ['body', 'auction_configuration', 'extension_minutes'], msg: 'Value error, Check the extension duration.' },
  ] } } });
  renderForm();
  await fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Create RFQ' }));
  expect(await screen.findByText('Check the extension duration.')).toBeTruthy();
  const extension = screen.getByLabelText('Extension duration (Y minutes)');
  await waitFor(() => expect(document.activeElement).toBe(extension));
  expect(extension.value).toBe('5');
  expect(screen.getByRole('button', { name: 'Create RFQ' }).disabled).toBe(false);
});

it('shows buyer loading and retry and blocks submission when there are no buyers', async () => {
  const get = vi.spyOn(apiClient, 'get')
    .mockRejectedValueOnce(new Error('Buyer list unavailable'))
    .mockResolvedValueOnce({ data: [] });
  renderForm();
  expect(screen.getByRole('option', { name: 'Loading buyers…' })).toBeTruthy();
  expect(await screen.findByText('Couldn’t load buyers.')).toBeTruthy();
  const submit = screen.getByRole('button', { name: 'Create RFQ' });
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry buyers' }));
  expect(await screen.findByText(/No buyer accounts are available/)).toBeTruthy();
  expect(submit.disabled).toBe(true);
  expect(get).toHaveBeenCalledTimes(2);
});
