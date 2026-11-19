import { getValidationErrors } from '../../components/formErrors.js';
import { parseLocalTime } from '../../rfqs/rfqForm.js';

export const chargeFields = [
  { name: 'freight_charge', label: 'Freight charges' },
  { name: 'origin_charge', label: 'Origin charges' },
  { name: 'destination_charge', label: 'Destination charges' },
];

export const initialQuoteForm = {
  supplier_id: '',
  carrier_name: '',
  freight_charge: '',
  origin_charge: '0.00',
  destination_charge: '0.00',
  transit_time_days: '',
  valid_until: '',
};

const maxChargeCents = 999_999_999_999;
const maxInteger = 2 ** 31 - 1;
const chargeError = 'Enter a nonnegative amount up to 9,999,999,999.99 with at most two decimal places.';

function parseCharge(value) {
  const text = value.trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= maxChargeCents ? cents : null;
}

export function getQuoteCharges(values) {
  const amounts = {};
  const errors = {};
  let cents = 0;
  for (const { name } of chargeFields) {
    const charge = parseCharge(values[name]);
    if (charge === null) {
      errors[name] = values[name].trim() ? chargeError : 'Enter an amount. Use 0 if there is no charge.';
    } else {
      cents += charge;
      amounts[name] = (charge / 100).toFixed(2);
    }
  }
  return { amounts, errors, total: Object.keys(errors).length ? null : (cents / 100).toFixed(2) };
}

export function getBiddingBlockReason(rfq, now) {
  if (!rfq.auction_configuration) return 'Quotes can be submitted to RFQs with British Auction enabled.';
  if (rfq.status === 'upcoming') return 'Bidding opens at the scheduled start time.';
  if (rfq.status === 'force_closed') return 'The auction reached its forced close.';
  if (rfq.status !== 'active' || now >= Math.min(Date.parse(rfq.current_close_at), Date.parse(rfq.forced_close_at))) {
    return 'Bidding is closed for this auction.';
  }
  return null;
}

export function validateQuote(values, suppliers, now) {
  const { amounts, errors } = getQuoteCharges(values);
  const supplier = suppliers.find(({ id }) => String(id) === values.supplier_id);
  const carrier = values.carrier_name.trim();
  const transit = Number(values.transit_time_days);
  const validity = values.valid_until ? parseLocalTime(values.valid_until) : { error: 'Enter a quote validity date and time.' };

  if (!supplier) errors.supplier_id = 'Select an available supplier.';
  if (!carrier) errors.carrier_name = 'Enter a carrier name.';
  else if (carrier.length > 160) errors.carrier_name = 'Use 160 characters or fewer.';
  else if (carrier.includes('\0')) errors.carrier_name = 'Remove the invalid character from the carrier name.';
  if (!values.transit_time_days.trim() || !Number.isInteger(transit) || transit < 0 || transit > maxInteger) {
    errors.transit_time_days = 'Enter a whole number of days from 0 to 2,147,483,647.';
  }
  if (validity.error) errors.valid_until = validity.error;
  else if (validity.date.getTime() <= now) errors.valid_until = 'Quote validity must be in the future.';

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    payload: {
      supplier_id: supplier.id,
      carrier_name: carrier,
      ...amounts,
      transit_time_days: transit,
      valid_until: validity.date.toISOString(),
    },
  };
}

export function getQuoteSubmissionErrors(error) {
  const { status, data } = error.response ?? {};
  if (status === 409) return { form: 'This auction is no longer accepting bids. The auction status is being refreshed.' };
  if (status === 404) return { form: 'This auction is no longer available.' };
  if (status === 422 && typeof data?.detail === 'string') {
    if (data.detail.startsWith('supplier_id')) return { supplier_id: 'This supplier is no longer available. Select another supplier.' };
    if (data.detail.startsWith('valid_until')) return { valid_until: 'Quote validity must be in the future.' };
  }
  if (status === 422) {
    const errors = getValidationErrors(data?.detail, initialQuoteForm);
    if (Object.keys(errors).length) return errors;
  }
  return { form: 'Couldn’t submit the quote. Check your connection and try again.' };
}
