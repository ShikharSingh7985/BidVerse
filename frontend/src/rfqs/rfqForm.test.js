import { afterEach, expect, it, vi } from 'vitest';
import { initialRfqForm, validateRfqForm } from './rfqForm.js';

const buyers = [{ id: 4, name: 'Ops buyer' }];
const validForm = {
  ...initialRfqForm,
  name: '  Regional Freight  ',
  reference_id: ' RFQ-2031-10 ',
  buyer_id: '4',
  currency: 'usd',
  bid_start_at: '2031-08-18T09:00',
  original_close_at: '2031-08-18T10:00',
  forced_close_at: '2031-08-18T11:00',
  service_date: '2031-08-19',
};

afterEach(() => vi.unstubAllEnvs());

it('converts local bidding times to UTC and keeps the date-only service value', () => {
  vi.stubEnv('TZ', 'Asia/Kolkata');
  const { errors, payload } = validateRfqForm(validForm, buyers);
  expect(errors).toEqual({});
  expect(payload).toEqual({
    name: 'Regional Freight',
    reference_id: 'RFQ-2031-10',
    buyer_id: 4,
    currency: 'USD',
    bid_start_at: '2031-08-18T03:30:00.000Z',
    original_close_at: '2031-08-18T04:30:00.000Z',
    forced_close_at: '2031-08-18T05:30:00.000Z',
    service_date: '2031-08-19',
    auction_configuration: {
      extension_trigger: 'bid_received',
      trigger_window_minutes: 10,
      extension_minutes: 5,
    },
  });
});

it('identifies nonexistent and ambiguous daylight-saving times', () => {
  vi.stubEnv('TZ', 'America/New_York');
  const spring = validateRfqForm({ ...validForm, bid_start_at: '2025-03-09T02:30' }, buyers);
  expect(spring.errors.bid_start_at).toContain('exists in your local time zone');
  const autumn = validateRfqForm({ ...validForm, bid_start_at: '2025-11-02T01:30' }, buyers);
  expect(autumn.errors.bid_start_at).toContain('occurs twice');
});

it('rejects an invalid calendar date, buyer, schedule, trigger, and extension values', () => {
  const { errors, payload } = validateRfqForm({
    ...validForm,
    buyer_id: '999',
    original_close_at: validForm.bid_start_at,
    forced_close_at: validForm.bid_start_at,
    service_date: '2031-02-29',
    extension_trigger: 'unknown',
    trigger_window_minutes: '0',
    extension_minutes: '2.5',
  }, buyers);
  expect(payload).toBeUndefined();
  expect(errors).toMatchObject({
    buyer_id: expect.stringContaining('available buyer'),
    original_close_at: expect.stringContaining('after the bid start'),
    forced_close_at: expect.stringContaining('after the initial close'),
    service_date: expect.stringContaining('valid service date'),
    extension_trigger: expect.stringContaining('extension trigger'),
    trigger_window_minutes: expect.stringContaining('whole number'),
    extension_minutes: expect.stringContaining('whole number'),
  });
});

it('skips validation for extension settings when British Auction is disabled', () => {
  const { errors, payload } = validateRfqForm({
    ...validForm,
    britishAuction: false,
    trigger_window_minutes: '0',
    extension_minutes: '',
  }, buyers);
  expect(errors).toEqual({});
  expect(payload.auction_configuration).toBeNull();
});
