import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { auctionReconcileInterval, auctionRefreshInterval, fetchRfq } from '../../api/rfqs.js';
import { secondaryButtonClass } from '../../components/buttonStyles.js';
import { paths } from '../../paths.js';
import { StatusBadge } from '../display.jsx';
import AuctionFeeds from './AuctionFeeds.jsx';
import AuctionOverview from './AuctionOverview.jsx';
import useAuctionUpdates from './useAuctionUpdates.js';

export default function AuctionDetailsPage() {
  const { rfqId } = useParams();
  const { state } = useLocation();
  const [connectedRfqId, setConnectedRfqId] = useState(null);
  const id = Number(rfqId);
  const validId = /^\d+$/.test(rfqId) && id > 0 && id <= 2 ** 31 - 1;
  const live = id === connectedRfqId;
  const refreshInterval = live ? auctionReconcileInterval : auctionRefreshInterval;
  const query = useQuery({
    queryKey: ['rfqs', id],
    queryFn: (context) => fetchRfq(id, context),
    enabled: validId,
    refetchInterval: (current) => current.state.error?.response?.status === 404 ? false : refreshInterval,
    retry: false,
  });
  const notFound = !validId || query.error?.response?.status === 404;
  const rfq = notFound ? undefined : query.data?.rfq;
  const createdRfq = state?.createdRfq;
  useAuctionUpdates(rfq?.id, setConnectedRfqId);

  return (
    <section aria-labelledby="page-title">
      <title>{rfq?.name ?? 'Auction details'} | BidVerse</title>
      <Link to={paths.auctions} className="inline-flex items-center gap-2 rounded-sm text-sm font-semibold text-muted hover:text-accent">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to auctions
      </Link>
      {createdRfq?.id === id && !notFound && (
        <p role="status" className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CircleCheck size={19} className="shrink-0" aria-hidden="true" />
          <span className="wrap-anywhere"><strong>{createdRfq.name}</strong> was created successfully.</span>
        </p>
      )}
      <div className="my-5 flex flex-wrap items-start justify-between gap-3 sm:my-6">
        <div className="min-w-0">
          <h1 id="page-title" className="wrap-anywhere text-3xl font-bold tracking-tight sm:text-4xl">
            {rfq?.name ?? 'Auction details'}
          </h1>
          {rfq && <p className="mt-1.5 wrap-anywhere text-sm text-muted">{rfq.reference_id}</p>}
        </div>
        {rfq && (
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium text-muted">
              {live ? 'Live updates' : 'Polling for updates'}
            </span>
            <StatusBadge status={rfq.status} />
          </div>
        )}
      </div>

      {notFound ? (
        <p role="alert" className="rounded-2xl border border-line bg-white p-5 text-sm text-muted">Auction not found.</p>
      ) : (
        <>
          {query.isPending && (
            <p role="status" className="rounded-2xl border border-line bg-white p-5 text-sm text-muted">Loading auction details…</p>
          )}
          {query.isError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p>{rfq ? 'Couldn’t refresh auction details. Showing the last loaded information.' : 'Couldn’t load auction details.'}</p>
              <button type="button" className={secondaryButtonClass} onClick={() => query.refetch()} disabled={query.isFetching}>
                Try again
              </button>
            </div>
          )}
          {rfq && (
            <div key={rfq.id} className="grid gap-4">
              <AuctionOverview rfq={rfq} clockOffset={query.data.clockOffset} onBoundary={query.refetch} />
              <AuctionFeeds rfqId={id} currency={rfq.currency} refreshInterval={refreshInterval} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
