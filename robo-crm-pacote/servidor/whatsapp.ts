/** Build a wa.me link from a (possibly formatted) Brazilian phone number. */
export function whatsappUrl(phone?: string | null, message?: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  // If user typed without country code (10–11 digits), assume Brazil 55.
  if (digits.length <= 11) digits = "55" + digits;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
