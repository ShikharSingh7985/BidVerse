import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { fetchSuppliers, refreshAuctionQueries, submitBid } from '../../api/rfqs.js';
import { primaryButtonClass, secondaryButtonClass } from '../../components/buttonStyles.js';
import Field from '../../components/FormField.jsx';
import { focusInvalidField } from '../../components/formErrors.js';
import { formatMoney } from '../display.jsx';
import DetailsPanel from './DetailsPanel.jsx';
import {
  chargeFields,
  getBiddingBlockReason,
  getQuoteCharges,
  getQuoteSubmissionErrors,
  initialQuoteForm,
  validateQuote,
} from './quoteForm.js';

export default function AuctionQuoteForm({ rfq, clockOffset, blockReason }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(initialQuoteForm);
  const [validated, setValidated] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const supplierQuery = useQuery({
    queryKey: ['suppliers'], queryFn: fetchSuppliers, enabled: !blockReason, retry: false,
  });
  const suppliers = supplierQuery.data ?? [];
  const mutation = useMutation({
    mutationFn: (payload) => submitBid(rfq.id, payload),
    onSuccess: () => refreshAuctionQueries(queryClient, rfq.id),
  });

  const now = Date.now() + clockOffset;
  const errors = { ...serverErrors, ...(validated ? validateQuote(values, suppliers, now).errors : {}) };
  const { total } = getQuoteCharges(values);

  function field(name) {
    return {
      name,
      value: values[name],
      error: errors[name],
      onChange: (event) => {
        const value = event.target.value;
        setValues((current) => ({ ...current, [name]: value }));
        setServerErrors((current) => ({ ...current, [name]: undefined, form: undefined }));
      },
    };
  }

  function submit(event) {
    event.preventDefault();
    if (mutation.isPending || blockReason) return;

    const submittedAt = Date.now() + clockOffset;
    const reason = getBiddingBlockReason(rfq, submittedAt);
    if (reason) {
      setServerErrors({ form: reason });
      void queryClient.invalidateQueries({ queryKey: ['rfqs', rfq.id], exact: true });
      return;
    }

    setValidated(true);
    setServerErrors({});
    const form = event.currentTarget;
    const { payload, errors: validationErrors } = validateQuote(values, suppliers, submittedAt);
    if (!payload) {
      requestAnimationFrame(() => focusInvalidField(form, validationErrors));
      return;
    }

    mutation.mutate(payload, {
      onSuccess: () => {
        setValues((current) => ({
          ...initialQuoteForm,
          supplier_id: current.supplier_id,
          carrier_name: current.carrier_name,
        }));
        setValidated(false);
      },
      onError: (error) => {
        const apiErrors = getQuoteSubmissionErrors(error);
        setServerErrors(apiErrors);
        requestAnimationFrame(() => focusInvalidField(form, apiErrors));
        if (apiErrors.supplier_id) void supplierQuery.refetch();
        if ([404, 409].includes(error.response?.status)) {
          void queryClient.invalidateQueries({ queryKey: ['rfqs', rfq.id], exact: true });
        }
      },
    });
  }

  return (
    <DetailsPanel title="Supplier quote" icon={Send}>
      <form noValidate onSubmit={submit} className="p-4 sm:p-5">
        {mutation.isSuccess && (
          <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Quote submitted successfully as bid #{mutation.data.id}.
          </p>
        )}
        {!mutation.isPending && Object.values(errors).some(Boolean) && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errors.form || 'Fix the highlighted fields and try again.'}
          </p>
        )}
        {blockReason ? (
          <p className="text-sm text-muted">{blockReason}</p>
        ) : (
          <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <legend className="sr-only">Quote details</legend>
            <Field {...field('supplier_id')} as="select" label="Supplier" disabled={suppliers.length === 0}>
              <option value="">{supplierQuery.isPending ? 'Loading suppliers…' : 'Select a supplier'}</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} (#{supplier.id})</option>)}
            </Field>
            <Field {...field('carrier_name')} label="Carrier name" maxLength={160} />
            <Field {...field('transit_time_days')} type="number" min={0} max={2 ** 31 - 1} step={1} label="Transit time (days)" />
            {chargeFields.map(({ name, label }) => (
              <Field key={name} {...field(name)} label={label} inputMode="decimal" placeholder="0.00" />
            ))}
            <div className="min-w-0 sm:col-span-2">
              <Field
                {...field('valid_until')}
                type="datetime-local"
                label="Quote valid until"
                hint={Intl.DateTimeFormat().resolvedOptions().timeZone}
              />
            </div>
            {supplierQuery.isError && (
              <div role="alert" className="col-span-full flex flex-wrap items-center gap-3 text-sm text-red-800">
                Couldn’t load suppliers.
                <button type="button" className={secondaryButtonClass} onClick={() => supplierQuery.refetch()} disabled={supplierQuery.isFetching}>
                  Retry suppliers
                </button>
              </div>
            )}
            {supplierQuery.isSuccess && suppliers.length === 0 && (
              <p role="status" className="col-span-full text-sm text-muted">
                No supplier accounts are available. Add a supplier account before submitting a quote.
              </p>
            )}
          </fieldset>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          {!blockReason && (
            <div className="min-w-0 text-sm">
              <span className="block text-xs font-medium text-muted">Calculated total</span>
              <output aria-label="Calculated total" className="mt-0.5 block wrap-anywhere font-semibold tabular-nums">
                {total === null ? '—' : formatMoney(total, rfq.currency)}
              </output>
            </div>
          )}
          <button
            type="submit"
            disabled={Boolean(blockReason) || mutation.isPending || suppliers.length === 0}
            className={`ml-auto ${primaryButtonClass}`}
          >
            {mutation.isPending ? (
              <>
                <LoaderCircle size={17} className="motion-safe:animate-spin" aria-hidden="true" />
                Submitting quote…
              </>
            ) : 'Submit quote'}
          </button>
        </div>
      </form>
    </DetailsPanel>
  );
}
