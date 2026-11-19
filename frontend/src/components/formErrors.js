export function focusInvalidField(form, errors) {
  const field = Array.from(form.elements).find((control) => errors[control.name] && !control.matches(':disabled'));
  field?.focus();
}

export function getValidationErrors(detail, fields) {
  const errors = {};
  if (!Array.isArray(detail)) return errors;

  for (const issue of detail) {
    if (typeof issue?.msg !== 'string') continue;
    const field = Array.isArray(issue.loc) ? issue.loc.at(-1) : undefined;
    const key = Object.hasOwn(fields, field) ? field : 'form';
    errors[key] ??= issue.msg.replace(/^Value error, /, '');
  }
  return errors;
}
