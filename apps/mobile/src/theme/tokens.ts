// Derived from the supplied TechArtha logo: indigo wordmark/circle + orange accent.
export const colors = {
  primary: '#3D3B8E',
  primaryDark: '#2E2C6F',
  accent: '#FF8A00',
  text: '#16162A',
  textMuted: '#5B5B73',
  bg: '#FFFFFF',
  surface: '#F5F5FA',
  border: '#D9D9E6',
  danger: '#B3261E',
  success: '#1E7B3A',
  white: '#FFFFFF',
};
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 };
export const type = {
  title: { fontSize: 24, fontWeight: '700' as const, lineHeight: 32 },
  heading: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, lineHeight: 24 },
  small: { fontSize: 13, lineHeight: 20 },
};
export const MIN_TOUCH = 48;
export const LOGO_ASPECT = 1870 / 517; // exact aspect of assets/techartha-logo.png (cropped only of surrounding whitespace)
