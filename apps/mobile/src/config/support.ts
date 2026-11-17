/** Official TechArtha support channels. Click-to-chat only: no live chat, no inbound-message integration is claimed. */
export const SUPPORT_WHATSAPP_E164 = '918308816023';
export const SUPPORT_WHATSAPP_DISPLAY = '+91 83088 16023';
export const SUPPORT_EMAIL = 'support@TechArtha.com';

/** Prefilled text must never contain sensitive data (PAN, OTP, passwords, account numbers). */
export function whatsappUrl(prefill: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_E164}?text=${encodeURIComponent(prefill)}`;
}
export function mailtoUrl(subject: string, body = ''): string {
  const q = [`subject=${encodeURIComponent(subject)}`, body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&');
  return `mailto:${SUPPORT_EMAIL}?${q}`;
}
