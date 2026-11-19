import { ArrowUpRight } from 'lucide-react';
import { generatePath, Link } from 'react-router';
import { paths } from '../paths.js';
import { AuctionTime, formatMoney, StatusBadge } from './display.jsx';

const cellClass = 'block min-w-0 @min-[44rem]:table-cell @min-[44rem]:border-t @min-[44rem]:border-line @min-[44rem]:px-4 @min-[44rem]:py-4';

function MobileLabel({ children }) {
  return (
    <span aria-hidden="true" className="mb-1 block text-xs font-medium text-muted @min-[44rem]:hidden">
      {children}
    </span>
  );
}

function LowestBid({ amount, currency }) {
  if (amount === null) return <span className="text-muted">No valid bids</span>;
  return <span className="wrap-anywhere font-semibold tabular-nums">{formatMoney(amount, currency)}</span>;
}

export default function AuctionsTable({ auctions }) {
  return (
    <div className="@container">
      <table role="table" className="block w-full text-left text-sm @min-[44rem]:table @min-[44rem]:table-fixed">
        <caption className="sr-only">Auctions and bidding deadlines</caption>
        <thead role="rowgroup" className="sr-only bg-canvas text-xs font-semibold text-muted @min-[44rem]:not-sr-only @min-[44rem]:table-header-group">
          <tr role="row">
            <th scope="col" className="w-[29%] px-4 py-3">RFQ name</th>
            <th scope="col" className="w-[17%] px-4 py-3">Lowest bid</th>
            <th scope="col" className="w-[19%] px-4 py-3">Current close</th>
            <th scope="col" className="w-[19%] px-4 py-3">Forced close</th>
            <th scope="col" className="w-[16%] px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="grid gap-3 p-3 @min-[44rem]:table-row-group @min-[44rem]:p-0">
          {auctions.map((auction) => (
            <tr
              key={auction.id}
              role="row"
              className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border border-line p-4 @min-[44rem]:table-row @min-[44rem]:border-0 @min-[44rem]:p-0 @min-[44rem]:hover:bg-canvas/70"
            >
              <th scope="row" className={`col-span-2 border-b border-line pb-3 text-left font-normal @min-[44rem]:border-b-0 ${cellClass}`}>
                <Link
                  to={generatePath(paths.auctionDetails, { rfqId: String(auction.id) })}
                  className="inline-flex max-w-full items-baseline gap-1.5 rounded-xs font-semibold text-ink hover:text-accent hover:underline"
                >
                  <span className="wrap-anywhere">{auction.name}</span>
                  <ArrowUpRight aria-hidden="true" size={14} className="shrink-0 self-center text-accent" />
                </Link>
                <span className="mt-1 block wrap-anywhere text-xs text-muted">{auction.reference_id}</span>
              </th>
              <td role="cell" className={cellClass}>
                <MobileLabel>Lowest bid</MobileLabel>
                <LowestBid amount={auction.lowest_bid} currency={auction.currency} />
              </td>
              <td role="cell" className={cellClass}>
                <MobileLabel>Current close</MobileLabel>
                <AuctionTime timestamp={auction.current_close_at} stacked />
              </td>
              <td role="cell" className={cellClass}>
                <MobileLabel>Forced close</MobileLabel>
                <AuctionTime timestamp={auction.forced_close_at} stacked />
              </td>
              <td role="cell" className={cellClass}>
                <MobileLabel>Status</MobileLabel>
                <StatusBadge status={auction.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
