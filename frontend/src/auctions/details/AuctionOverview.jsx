import { CalendarClock, Clock3, FileText, Gavel, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { auctionTriggers } from '../../rfqs/rfqForm.js';
import { AuctionTime, ServiceDate } from '../display.jsx';
import AuctionQuoteForm from './AuctionQuoteForm.jsx';
import DetailsPanel, { DetailValue } from './DetailsPanel.jsx';
import { getBiddingBlockReason } from './quoteForm.js';

function formatCountdown(totalSeconds) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor(totalSeconds / 3_600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${clock}` : clock;
}

function Countdown({ rfq, now, closed, onBoundary }) {
  const upcoming = rfq.status === 'upcoming';
  const target = upcoming ? rfq.bid_start_at : rfq.current_close_at;
  const seconds = Math.max(0, Math.ceil((Date.parse(target) - now) / 1000));
  const reachedBoundary = !closed && seconds === 0;

  useEffect(() => {
    if (!reachedBoundary) return;
    let cancelled = false;
    let retryTimer;

    async function checkStatus(retriesLeft) {
      const result = await onBoundary({ cancelRefetch: false });
      if (!cancelled && !result.isError && retriesLeft > 0) {
        retryTimer = setTimeout(() => void checkStatus(retriesLeft - 1), 1500);
      }
    }

    void checkStatus(2);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [reachedBoundary, rfq.status, target, onBoundary]);

  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl bg-sidebar p-5 text-white">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-indigo-200">
        <Clock3 size={19} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-sidebar-muted">
          {closed ? 'Auction countdown' : upcoming ? 'Bidding opens in' : 'Time remaining'}
        </h2>
        {closed ? (
          <p className="mt-1.5 text-lg font-semibold">
            {rfq.status === 'force_closed' ? 'Forced close reached' : 'Bidding closed'}
          </p>
        ) : seconds === 0 ? (
          <p role="status" className="mt-1.5 text-base font-semibold">Checking auction status…</p>
        ) : (
          <p role="timer" className="mt-1.5 wrap-anywhere text-2xl font-semibold tracking-tight tabular-nums">
            {formatCountdown(seconds)}
          </p>
        )}
      </div>
    </div>
  );
}

function ClosingTime({ title, timestamp, icon: Icon }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-white p-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        <div className="mt-1.5 text-base"><AuctionTime timestamp={timestamp} stacked /></div>
      </div>
    </div>
  );
}

export default function AuctionOverview({ rfq, clockOffset, onBoundary, bidHistory }) {
  const [now, setNow] = useState(Date.now);
  const closed = rfq.status === 'closed' || rfq.status === 'force_closed';
  const serverNow = now + clockOffset;
  const config = rfq.auction_configuration;

  useEffect(() => {
    if (!closed) {
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }
  }, [closed]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Countdown rfq={rfq} now={serverNow} closed={closed} onBoundary={onBoundary} />
        <ClosingTime title="Current close" timestamp={rfq.current_close_at} icon={CalendarClock} />
        <ClosingTime title="Forced close" timestamp={rfq.forced_close_at} icon={ShieldCheck} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <DetailsPanel title="RFQ information" icon={FileText}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-5 sm:px-5">
            <DetailValue label="Buyer ID">#{rfq.buyer_id}</DetailValue>
            <DetailValue label="Currency">{rfq.currency}</DetailValue>
            <DetailValue label="Bid start"><AuctionTime timestamp={rfq.bid_start_at} /></DetailValue>
            <DetailValue label="Initial close"><AuctionTime timestamp={rfq.original_close_at} /></DetailValue>
            <DetailValue label="Service date"><ServiceDate date={rfq.service_date} /></DetailValue>
            <DetailValue label="Created"><AuctionTime timestamp={rfq.created_at} /></DetailValue>
          </dl>
        </DetailsPanel>
        <DetailsPanel title="Auction configuration" icon={Gavel}>
          {config ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-5 sm:px-5">
              <DetailValue label="Trigger window (X)">{config.trigger_window_minutes} min</DetailValue>
              <DetailValue label="Extension duration (Y)">{config.extension_minutes} min</DetailValue>
              <DetailValue label="Extension trigger" className="col-span-2">{auctionTriggers[config.extension_trigger]}</DetailValue>
            </dl>
          ) : (
            <p className="px-4 py-5 text-sm text-muted sm:px-5">This RFQ uses a fixed deadline. Extension settings apply to British Auctions.</p>
          )}
        </DetailsPanel>
      </div>
      <AuctionQuoteForm
        rfq={rfq}
        clockOffset={clockOffset}
        blockReason={getBiddingBlockReason(rfq, serverNow)}
        bidHistory={bidHistory}
      />
    </>
  );
}
