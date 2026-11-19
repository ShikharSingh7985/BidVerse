import { apiClient } from './client.js';

export const auctionListQueryKey = ['rfqs', 'auctions'];
export const auctionRefreshInterval = 10_000;
export const auctionReconcileInterval = 60_000;

export async function fetchAuctions({ signal }) {
  const { data } = await apiClient.get('/rfqs', {
    params: { auction_only: true },
    signal,
  });
  return data;
}

export async function fetchBuyers({ signal }) {
  const { data } = await apiClient.get('/buyers', { signal });
  return data;
}

export async function fetchSuppliers({ signal }) {
  const { data } = await apiClient.get('/suppliers', { signal });
  return data;
}

export async function createRfq(payload) {
  const { data } = await apiClient.post('/rfqs', payload);
  return data;
}

export async function fetchRfq(rfqId, { signal }) {
  const { data, headers } = await apiClient.get(`/rfqs/${rfqId}`, { signal });
  const serverTime = Date.parse(headers?.date);
  return {
    rfq: data,
    clockOffset: Number.isFinite(serverTime) ? serverTime - Date.now() : 0,
  };
}

export async function fetchRfqResource(rfqId, resource, { signal }) {
  const { data } = await apiClient.get(`/rfqs/${rfqId}/${resource}`, { signal });
  return data;
}

export async function submitBid(rfqId, payload) {
  const { data } = await apiClient.post(`/rfqs/${rfqId}/bids`, payload);
  return data;
}

export function getAuctionUpdatesUrl(rfqId) {
  const base = new URL(apiClient.defaults.baseURL || '/', window.location.origin);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = base.pathname.replace(/\/+$/, '') + `/rfqs/${rfqId}/ws`;
  base.search = '';
  base.hash = '';
  return base.href;
}

export function refreshAuctionQueries(queryClient, rfqId) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['rfqs', rfqId] }),
    queryClient.invalidateQueries({ queryKey: auctionListQueryKey }),
  ]);
}
