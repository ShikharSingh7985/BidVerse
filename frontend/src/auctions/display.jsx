import { auctionStatuses } from './statuses.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const serviceDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function formatMoney(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function AuctionTime({ timestamp, stacked = false }) {
  const date = new Date(timestamp);
  return stacked ? (
    <time dateTime={timestamp} className="block tabular-nums">
      <span className="block font-medium">{dateFormat.format(date)}</span>
      <span className="mt-0.5 block text-xs text-muted">{timeFormat.format(date)}</span>
    </time>
  ) : (
    <time dateTime={timestamp} className="tabular-nums">
      {dateFormat.format(date)} · {timeFormat.format(date)}
    </time>
  );
}

export function ServiceDate({ date }) {
  return <time dateTime={date}>{serviceDateFormat.format(new Date(date + 'T00:00:00Z'))}</time>;
}

export function StatusBadge({ status }) {
  const { label, colors, dot } = auctionStatuses[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${colors}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
