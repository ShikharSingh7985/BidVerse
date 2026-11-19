import { afterEach, expect, it, vi } from 'vitest';
import { getBiddingBlockReason, getQuoteCharges, initialQuoteForm, validateQuote } from './quoteForm.js';

const suppliers = [{ id: 4, name: 'Air freight' }];
const time = Date.parse('2031-08-18T03:00:00Z');
const draft = {
  ...initialQuoteForm,
  supplier_id: '4',
  carrier_name: '  Air Freight  ',
  freight_charge: '0.10',
  origin_charge: '0,20',
  transit_time_days: '0',
  valid_until: '2031-08-18T09:00',
};

afterEach(() => vi.unstubAllEnvs());

it('calculates exact cents and sends normalized quote values and UTC validity', () => {
  vi.stubEnv('TZ', 'Asia/Kolkata');
  expect(getQuoteCharges(draft).total).toBe('0.30');
  expect(validateQuote(draft, suppliers, time)).toEqual({
    errors: {},
    payload: {
      supplier_id: 4,
      carrier_name: 'Air Freight',
      freight_charge: '0.10',
      origin_charge: '0.20',
      destination_charge: '0.00',
      transit_time_days: 0,
      valid_until: '2031-08-18T03:30:00.000Z',
    },
  });
});

it('preserves cents at the database precision limit', () => {
  const charges = getQuoteCharges({
    freight_charge: '9999999999.99',
    origin_charge: '9999999999.99',
    destination_charge: '9999999999.99',
  });
  expect(charges.errors).toEqual({});
  expect(charges.total).toBe('29999999999.97');
});

it('rejects invalid charges, unavailable suppliers, fractional transit, and expired validity', () => {
  vi.stubEnv('TZ', 'Asia/Kolkata');
  const invalid = {
    ...draft,
    supplier_id: '123',
    carrier_name: ' ',
    freight_charge: '-1.00',
    origin_charge: '1.005',
    destination_charge: '10000000000',
    transit_time_days: '0.5',
    valid_until: '2031-08-18T08:30',
  };
  expect(getQuoteCharges(invalid).total).toBeNull();
  const { errors, payload } = validateQuote(invalid, suppliers, time);
  expect(payload).toBeUndefined();
  expect(Object.keys(errors).sort()).toEqual(Object.keys(initialQuoteForm).sort());
  expect(errors.valid_until).toBe('Quote validity must be in the future.');
});

it('permits bids only while a British Auction is active and before its cutoff', () => {
  const rfq = {
    auction_configuration: { extension_trigger: 'bid_received' },
    status: 'active',
    current_close_at: '2031-08-18T03:15:00Z',
    forced_close_at: '2031-08-18T03:30:00Z',
  };
  expect(getBiddingBlockReason(rfq, time)).toBeNull();
  expect(getBiddingBlockReason(rfq, Date.parse(rfq.current_close_at))).toBeTruthy();
  expect(getBiddingBlockReason({ ...rfq, status: 'upcoming' }, time)).toBeTruthy();
  expect(getBiddingBlockReason({ ...rfq, status: 'force_closed' }, time)).toBeTruthy();
  expect(getBiddingBlockReason({ ...rfq, auction_configuration: null }, time)).toBeTruthy();
});
