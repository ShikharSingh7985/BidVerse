import { useQuery } from '@tanstack/react-query';
import { ChevronDown, CircleAlert, Gavel, ListFilter, LoaderCircle, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { auctionListQueryKey, fetchAuctions } from '../api/rfqs.js';
import { secondaryButtonClass } from '../components/buttonStyles.js';
import { paths } from '../paths.js';
import AuctionsTable from './AuctionsTable.jsx';
import { auctionStatuses } from './statuses.js';

function ListingState({ icon: Icon, iconClassName, title, role, children }) {
  return (
    <div role={role} className="grid min-h-64 place-items-center px-5 py-10 text-center">
      <div className="grid max-w-sm justify-items-center gap-3">
        <div className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon size={22} strokeWidth={1.8} aria-hidden="true" className={iconClassName} />
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function AuctionsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const query = useQuery({
    queryKey: auctionListQueryKey,
    queryFn: fetchAuctions,
    refetchInterval: 15_000,
    retry: false,
  });

  const auctions = query.data ?? [];
  const term = search.trim().toLowerCase();
  const visibleAuctions = auctions.filter((auction) => (
    (status === 'all' || auction.status === status)
    && (auction.name.toLowerCase().includes(term) || auction.reference_id.toLowerCase().includes(term))
  ));

  function clearFilters() {
    setSearch('');
    setStatus('all');
  }

  const retry = (
    <button type="button" className={secondaryButtonClass} onClick={() => query.refetch()} disabled={query.isFetching}>
      Try again
    </button>
  );

  return (
    <section aria-labelledby="page-title">
      <title>Auctions | BidVerse</title>
      <h1 id="page-title" className="text-3xl font-bold tracking-tight sm:text-4xl">Auctions</h1>
      <p className="mt-2 text-sm leading-6 text-muted sm:text-base">Track supplier bids and closing deadlines.</p>

      <div className="mt-7 overflow-hidden rounded-2xl border border-line bg-white shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:justify-between sm:p-4">
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Search auctions</span>
            <Search size={17} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or reference ID"
              className="min-h-11 w-full rounded-lg border border-line bg-white py-2 pr-3 pl-9 text-sm placeholder:text-muted"
            />
          </label>
          <label className="relative block w-full sm:w-44">
            <span className="sr-only">Filter by status</span>
            <ListFilter size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-11 w-full appearance-none rounded-lg border border-line bg-white py-2 pr-8 pl-9 text-sm font-medium"
            >
              <option value="all">All statuses</option>
              {Object.entries(auctionStatuses).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <ChevronDown size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
          </label>
        </div>

        {query.isPending && (
          <ListingState icon={LoaderCircle} iconClassName="motion-safe:animate-spin" title="Loading auctions…" role="status" />
        )}
        {query.isError && query.data === undefined && (
          <ListingState icon={CircleAlert} title="Couldn’t load auctions" role="alert">
            <p className="text-sm text-muted">Check your connection and try again.</p>
            {retry}
          </ListingState>
        )}
        {query.data !== undefined && (
          <>
            {query.isError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                Couldn’t refresh auctions. Showing the last loaded results.
                {retry}
              </div>
            )}
            {auctions.length === 0 && (
              <ListingState icon={Gavel} title="No auctions yet">
                <p className="text-sm text-muted">Create an RFQ with British Auction enabled to list it here.</p>
                <Link to={paths.createRfq} className={secondaryButtonClass}>Create an RFQ</Link>
              </ListingState>
            )}
            {auctions.length > 0 && visibleAuctions.length === 0 && (
              <ListingState icon={Search} title="No auctions match your filters">
                <button type="button" onClick={clearFilters} className={secondaryButtonClass}>Clear filters</button>
              </ListingState>
            )}
            {visibleAuctions.length > 0 && (
              <>
                <AuctionsTable auctions={visibleAuctions} />
                <p role="status" className="border-t border-line px-4 py-3 text-xs tabular-nums text-muted">
                  {visibleAuctions.length} of {auctions.length} {auctions.length === 1 ? 'auction' : 'auctions'}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
