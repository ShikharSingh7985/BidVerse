import { getValidationErrors } from '../components/formErrors.js';

export const auctionTriggers = {
  bid_received: 'Any bid received',
  supplier_rank_changed: 'Any supplier rank change',
  lowest_bidder_changed: 'Lowest bidder (L1) change',
};

export const initialRfqForm = {
  name: '',
  reference_id: '',
  buyer_id: '',
  currency: '',
  bid_start_at: '',
  original_close_at: '',
  forced_close_at: '',
  service_date: '',
  britishAuction: true,
  extension_trigger: 'bid_received',
  trigger_window_minutes: '10',
  extension_minutes: '5',
};

const maxInteger = 2 ** 31 - 1;
const deadlineFields = [
  ['bid_start_at', 'Enter a bid start time.'],
  ['original_close_at', 'Enter an initial close time.'],
  ['forced_close_at', 'Enter a forced close time.'],
];

function matchesLocalTime(date, parts) {
  return [
    date.getFullYear(), date.getMonth() + 1, date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(),
  ].every((part, index) => part === parts[index]);
}

export function parseLocalTime(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!parts || Number(parts[1]) === 0) return { error: 'Enter a valid date and time.' };

  const date = new Date(value);
  const localParts = parts.slice(1).map((part) => Number(part ?? 0));
  if (!matchesLocalTime(date, localParts)) {
    return { error: 'Enter a date and time that exists in your local time zone.' };
  }
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    return { error: 'Choose a date within the supported calendar range.' };
  }

  const followingDay = new Date(date.getTime() + 86_400_000);
  const clockShift = followingDay.getTimezoneOffset() - date.getTimezoneOffset();
  if (clockShift > 0 && matchesLocalTime(new Date(date.getTime() + clockShift * 60_000), localParts)) {
    return { error: 'This time occurs twice when clocks change. Choose a time outside the repeated period.' };
  }
  return { date };
}

function isValidServiceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRfqForm(values, buyers) {
  const errors = {};
  const name = values.name.trim();
  const referenceId = values.reference_id.trim();
  const currency = values.currency.trim().toUpperCase();
  const buyer = buyers.find(({ id }) => String(id) === values.buyer_id);

  if (!name) errors.name = 'Enter an RFQ name.';
  else if (name.length > 160) errors.name = 'Use 160 characters or fewer.';
  else if (name.includes('\0')) errors.name = 'Remove the invalid character from the RFQ name.';
  if (!referenceId) errors.reference_id = 'Enter a reference ID.';
  else if (referenceId.length > 64) errors.reference_id = 'Use 64 characters or fewer.';
  else if (referenceId.includes('\0')) errors.reference_id = 'Remove the invalid character from the reference ID.';
  if (!buyer) errors.buyer_id = 'Select an available buyer.';
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Enter a three-letter currency code, such as USD.';
  if (!isValidServiceDate(values.service_date)) errors.service_date = 'Enter a valid service date.';

  const deadlines = {};
  for (const [field, requiredMessage] of deadlineFields) {
    if (!values[field]) {
      errors[field] = requiredMessage;
    } else {
      const { date, error } = parseLocalTime(values[field]);
      if (error) errors[field] = error;
      else deadlines[field] = date;
    }
  }
  const { bid_start_at: start, original_close_at: initial, forced_close_at: forced } = deadlines;
  if (start && initial && initial <= start) errors.original_close_at = 'Initial close must be after the bid start.';
  if (initial && forced && forced <= initial) errors.forced_close_at = 'Forced close must be after the initial close.';

  let configuration = null;
  if (values.britishAuction) {
    const { extension_trigger: trigger } = values;
    if (!Object.hasOwn(auctionTriggers, trigger)) errors.extension_trigger = 'Select an extension trigger.';
    const window = Number(values.trigger_window_minutes);
    const extension = Number(values.extension_minutes);
    if (!Number.isInteger(window) || window <= 0 || window > maxInteger) {
      errors.trigger_window_minutes = 'Enter a whole number from 1 to 2,147,483,647.';
    }
    if (!Number.isInteger(extension) || extension <= 0 || extension > maxInteger) {
      errors.extension_minutes = 'Enter a whole number from 1 to 2,147,483,647.';
    }
    configuration = {
      extension_trigger: trigger,
      trigger_window_minutes: window,
      extension_minutes: extension,
    };
  }

  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    payload: {
      name,
      reference_id: referenceId,
      buyer_id: buyer.id,
      currency,
      service_date: values.service_date,
      bid_start_at: start.toISOString(),
      original_close_at: initial.toISOString(),
      forced_close_at: forced.toISOString(),
      auction_configuration: configuration,
    },
  };
}

export function getRfqCreationErrors(error) {
  const { status, data } = error.response ?? {};
  if (status === 409) return { reference_id: 'This reference ID is already in use. Choose a different one.' };

  const detail = data?.detail;
  if (status === 422 && typeof detail === 'string' && detail.startsWith('buyer_id')) {
    return { buyer_id: 'This buyer is no longer available. Select another buyer.' };
  }
  if (status === 422) {
    const errors = getValidationErrors(detail, initialRfqForm);
    if (Object.keys(errors).length > 0) return errors;
  }
  return { form: 'Couldn’t create the RFQ. Check your connection and try again.' };
}
