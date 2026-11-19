import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileText, Gavel, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { generatePath, useNavigate } from 'react-router';
import { auctionListQueryKey, createRfq, fetchBuyers } from '../api/rfqs.js';
import { primaryButtonClass, secondaryButtonClass } from '../components/buttonStyles.js';
import Field from '../components/FormField.jsx';
import { focusInvalidField } from '../components/formErrors.js';
import { paths } from '../paths.js';
import {
  auctionTriggers, getRfqCreationErrors, initialRfqForm, validateRfqForm,
} from './rfqForm.js';

function FormSection({ icon: Icon, title, accessory, children }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-line bg-white shadow-sm shadow-slate-950/5">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <h2 className="flex items-center gap-2.5 text-base font-semibold">
          <Icon size={19} strokeWidth={1.8} className="text-accent" aria-hidden="true" />
          {title}
        </h2>
        {accessory}
      </div>
      <div className="grid min-w-0 gap-x-5 gap-y-4 p-4 sm:grid-cols-2 sm:p-6">{children}</div>
    </section>
  );
}

export default function CreateRfqPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(initialRfqForm);
  const [validated, setValidated] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const buyerQuery = useQuery({ queryKey: ['buyers'], queryFn: fetchBuyers, retry: false });
  const buyers = buyerQuery.data ?? [];
  const mutation = useMutation({
    mutationFn: createRfq,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: auctionListQueryKey }); },
  });
  const clientErrors = validated ? validateRfqForm(values, buyers).errors : {};
  const errors = { ...serverErrors, ...clientErrors };
  const hasErrors = Object.values(errors).some(Boolean);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function updateField(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    setServerErrors((current) => {
      if (name === 'britishAuction') {
        const { extension_trigger, trigger_window_minutes, extension_minutes, form, ...remaining } = current;
        return remaining;
      }
      return { ...current, [name]: undefined, form: undefined };
    });
  }

  function field(name) {
    return {
      name,
      error: errors[name],
      value: values[name],
      onChange: (event) => updateField(name, event.target.value),
    };
  }

  function submit(event) {
    event.preventDefault();
    if (mutation.isPending) return;
    setValidated(true);
    setServerErrors({});
    const form = event.currentTarget;
    const { errors: validationErrors, payload } = validateRfqForm(values, buyers);
    if (!payload) {
      requestAnimationFrame(() => focusInvalidField(form, validationErrors));
      return;
    }

    mutation.mutate(payload, {
      onSuccess: (rfq) => {
        navigate(generatePath(paths.auctionDetails, { rfqId: String(rfq.id) }), {
          replace: true,
          state: { createdRfq: { id: rfq.id, name: rfq.name } },
        });
      },
      onError: (error) => {
        const apiErrors = getRfqCreationErrors(error);
        setServerErrors(apiErrors);
        if (apiErrors.buyer_id) void buyerQuery.refetch();
        requestAnimationFrame(() => focusInvalidField(form, apiErrors));
      },
    });
  }

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <title>Create RFQ | BidVerse</title>
      <h1 id="page-title" className="text-3xl font-bold tracking-tight sm:text-4xl">Create RFQ</h1>
      <p className="mt-2 text-sm leading-6 text-muted sm:text-base">
        Set the bidding schedule and extension rules for your request.
      </p>

      <form noValidate onSubmit={submit} className="mt-7">
        {hasErrors && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errors.form || 'Fix the highlighted fields and try again.'}
          </p>
        )}

        <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-5">
          <legend className="sr-only">RFQ form</legend>
          <FormSection icon={FileText} title="RFQ details">
            <Field {...field('name')} label="RFQ name" maxLength={160} placeholder="e.g. Regional freight services" />
            <Field {...field('reference_id')} label="Reference ID" maxLength={64} placeholder="e.g. RFQ-2026-001" />
            <Field {...field('buyer_id')} as="select" label="Buyer" disabled={buyers.length === 0}>
              <option value="">
                {buyerQuery.isPending ? 'Loading buyers…' : 'Select a buyer'}
              </option>
              {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.name} (#{buyer.id})</option>)}
            </Field>
            <Field {...field('currency')} label="Currency" maxLength={3} placeholder="e.g. USD" autoCapitalize="characters" />

            {buyerQuery.isError && (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-800 sm:col-span-2">
                Couldn’t load buyers.
                <button type="button" className={secondaryButtonClass} onClick={() => buyerQuery.refetch()} disabled={buyerQuery.isFetching}>
                  Retry buyers
                </button>
              </div>
            )}
            {buyerQuery.isSuccess && buyers.length === 0 && (
              <p role="status" className="text-sm text-muted sm:col-span-2">
                No buyer accounts are available. Add a buyer account before creating an RFQ.
              </p>
            )}
          </FormSection>

          <FormSection
            icon={CalendarClock}
            title="Bidding schedule"
            accessory={<span className="rounded-md bg-canvas px-2.5 py-1 text-xs font-medium text-muted">{timeZone}</span>}
          >
            <Field {...field('bid_start_at')} type="datetime-local" label="Bid start time" />
            <Field {...field('original_close_at')} type="datetime-local" label="Initial close time" />
            <Field {...field('forced_close_at')} type="datetime-local" label="Forced close time" hint="The latest time the auction can close." />
            <Field {...field('service_date')} type="date" label="Service date" />
          </FormSection>

          <FormSection
            icon={Gavel}
            title="British Auction"
            accessory={(
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  role="switch"
                  className="peer sr-only"
                  checked={values.britishAuction}
                  onChange={(event) => updateField('britishAuction', event.target.checked)}
                />
                <span aria-hidden="true" className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
                Enable British Auction
              </label>
            )}
          >
            {values.britishAuction ? (
              <>
                <div className="min-w-0 sm:col-span-2">
                  <Field {...field('extension_trigger')} as="select" label="Extension trigger">
                    {Object.entries(auctionTriggers).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Field>
                </div>
                <Field {...field('trigger_window_minutes')} type="number" min={1} max={2 ** 31 - 1} step={1} label="Trigger window (X minutes)" hint="Check qualifying bids in the last X minutes." />
                <Field {...field('extension_minutes')} type="number" min={1} max={2 ** 31 - 1} step={1} label="Extension duration (Y minutes)" hint="Add Y minutes up to the forced close." />
              </>
            ) : (
              <p className="text-sm text-muted sm:col-span-2">Enable British Auction to accept supplier bids and configure extensions.</p>
            )}
          </FormSection>
        </fieldset>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className={secondaryButtonClass} onClick={() => navigate(paths.auctions)} disabled={mutation.isPending}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || buyers.length === 0}
            className={primaryButtonClass}
          >
            {mutation.isPending ? (
              <>
                <LoaderCircle size={17} aria-hidden="true" className="motion-safe:animate-spin" />
                <span role="status">Creating RFQ…</span>
              </>
            ) : 'Create RFQ'}
          </button>
        </div>
      </form>
    </section>
  );
}
