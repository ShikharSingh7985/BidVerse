import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Clock3, History, ListOrdered } from 'lucide-react';
import { fetchRfqResource } from '../../api/rfqs.js';
import { secondaryButtonClass } from '../../components/buttonStyles.js';
import { auctionTriggers } from '../../rfqs/rfqForm.js';
import { AuctionTime, formatMoney } from '../display.jsx';
import DetailsPanel, { DetailValue } from './DetailsPanel.jsx';

export function useAuctionResource(rfqId, resource, refreshInterval, enabled = true) {
  return useQuery({
    queryKey: ['rfqs', rfqId, resource],
    queryFn: (context) => fetchRfqResource(rfqId, resource, context),
    enabled,
    refetchInterval: refreshInterval,
    retry: false,
  });
}

function QueryPanel({ title, icon, query, empty, children }) {
  return (
    <DetailsPanel title={title} icon={icon}>
      {query.isPending && (
        <p role="status" className="p-5 text-sm text-muted">Loading {title.toLowerCase()}…</p>
      )}
      {query.isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-5">
          <p>{query.data ? 'Couldn’t refresh ' : 'Couldn’t load '}{title.toLowerCase()}.</p>
          <button type="button" className={secondaryButtonClass} onClick={() => query.refetch()} disabled={query.isFetching}>
            Try again
          </button>
        </div>
      )}
      {query.data?.length === 0 && <p className="p-5 text-sm text-muted">{empty}</p>}
      {query.data?.length > 0 && children(query.data)}
    </DetailsPanel>
  );
}

function RankingList({ rankings, currency }) {
  return (
    <ol className="divide-y divide-line">
      {rankings.map((entry) => (
        <li key={entry.bid_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 max-w-full items-center gap-3">
            <span className={`grid min-w-9 shrink-0 place-items-center rounded-md px-1.5 py-1 text-xs font-bold ${entry.rank === 'L1' ? 'bg-accent-soft text-accent' : 'bg-canvas text-muted'}`}>
              {entry.rank}
            </span>
            <div className="min-w-0">
              <p className="wrap-anywhere text-sm font-semibold">{entry.carrier_name}</p>
              <p className="mt-0.5 text-xs text-muted">Supplier #{entry.supplier_id}</p>
            </div>
          </div>
          <span className="min-w-0 max-w-full wrap-anywhere text-sm font-semibold tabular-nums">{formatMoney(entry.total_price, currency)}</span>
        </li>
      ))}
    </ol>
  );
}

function BidHistory({ bids, currency }) {
  return (
    <ul className="divide-y divide-line">
      {bids.map((bid) => (
        <li key={bid.id}>
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2 rounded-sm px-4 py-3.5 hover:bg-canvas sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block wrap-anywhere text-sm font-semibold">{bid.carrier_name}</span>
                <span className="mt-0.5 block text-xs text-muted">Supplier #{bid.supplier_id} · Bid #{bid.id}</span>
                <span className="mt-1 block text-xs text-muted">
                  <AuctionTime timestamp={bid.submitted_at} />
                </span>
              </span>
              <span className="flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold tabular-nums">
                <span className="min-w-0 wrap-anywhere">{formatMoney(bid.total_price, currency)}</span>
                <ChevronDown size={17} className="shrink-0 text-muted group-open:rotate-180" aria-hidden="true" />
              </span>
            </summary>
            <dl className="grid gap-4 border-t border-line bg-canvas/70 px-4 py-4 min-[360px]:grid-cols-2 sm:px-5">
              <DetailValue label="Freight charge">{formatMoney(bid.freight_charge, currency)}</DetailValue>
              <DetailValue label="Origin charge">{formatMoney(bid.origin_charge, currency)}</DetailValue>
              <DetailValue label="Destination charge">{formatMoney(bid.destination_charge, currency)}</DetailValue>
              <DetailValue label="Transit time">{bid.transit_time_days} {bid.transit_time_days === 1 ? 'day' : 'days'}</DetailValue>
              <DetailValue label="Quote valid until" className="min-[360px]:col-span-2">
                <AuctionTime timestamp={bid.valid_until} />
              </DetailValue>
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

function ActivityLog({ events }) {
  return (
    <ol className="mx-4 my-5 space-y-5 border-l border-line pl-4 sm:mx-5">
      {events.map((event) => {
        const extended = event.event_type === 'time_extended';
        return (
          <li key={event.id} className="relative min-w-0">
            <span aria-hidden="true" className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-white ${extended ? 'bg-accent' : 'bg-slate-400'}`} />
            <div className="text-xs text-muted"><AuctionTime timestamp={event.occurred_at} /></div>
            <p className="mt-1 text-sm font-semibold">{extended ? 'Deadline extended' : 'Bid submitted'}</p>
            <p className="mt-0.5 text-xs text-muted">Bid #{event.bid_id}</p>
            {extended && (
              <div className="mt-2 rounded-lg bg-accent-soft/65 p-3">
                <p className="mb-2 text-xs font-semibold text-accent-strong">{auctionTriggers[event.extension_trigger]}</p>
                <dl className="grid gap-2">
                  <DetailValue label="Previous close"><AuctionTime timestamp={event.previous_close_at} /></DetailValue>
                  <DetailValue label="New close"><AuctionTime timestamp={event.new_close_at} /></DetailValue>
                </dl>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function AuctionFeeds({ rfqId, currency, refreshInterval, bids }) {
  const rankings = useAuctionResource(rfqId, 'rankings', refreshInterval);
  const activity = useAuctionResource(rfqId, 'activity', refreshInterval);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid min-w-0 gap-4">
        <QueryPanel title="Supplier rankings" icon={ListOrdered} query={rankings} empty="No currently valid bids to rank.">
          {(items) => <RankingList rankings={items} currency={currency} />}
        </QueryPanel>
        <QueryPanel title="Bid history" icon={History} query={bids} empty="No bids have been submitted.">
          {(items) => <BidHistory bids={items} currency={currency} />}
        </QueryPanel>
      </div>
      <QueryPanel title="Activity log" icon={Clock3} query={activity} empty="No auction activity yet.">
        {(items) => <ActivityLog events={items} />}
      </QueryPanel>
    </div>
  );
}
