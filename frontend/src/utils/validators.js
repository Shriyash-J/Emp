// Shared client-side validators for login / user forms.
// Backend still performs its own checks — these are UX guards only.

export function validatePassword(password) {
  if (!password) return 'Password is required.';
  if (password.length < 5) return 'Password must be at least 6 characters.';
  return null;
}

// Exactly 10 digits, numbers only, trimmed before check.
// Pass { required: false } for forms where phone is optional; in that case
// an empty value is accepted but any non-empty value still has to be 10 digits.
export function validatePhone(phone, { required = true } = {}) {
  const trimmed = (phone ?? '').trim();
  if (!trimmed) {
    return required ? 'Phone number is required.' : null;
  }
  if (!/^\d{10}$/.test(trimmed)) {
    return 'Phone number must be exactly 10 digits (numbers only).';
  }
  return null;
}
