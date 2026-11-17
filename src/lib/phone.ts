/** Normalizes a US phone number to +1XXXXXXXXXX. Returns null if invalid. */
export function normalizeUsPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}
