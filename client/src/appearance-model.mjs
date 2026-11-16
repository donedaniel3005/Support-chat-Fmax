export const APPEARANCE_KEY = 'support-appearance';
export const preferences = ['light', 'dark', 'system'];
export function validPreference(value) { return preferences.includes(value) ? value : 'system'; }
export function resolveAppearance(preference, systemDark) {
  const normalized = validPreference(preference);
  return normalized === 'system' ? (systemDark ? 'dark' : 'light') : normalized;
}
export function readableText(background) {
  if (!/^#[a-f0-9]{6}$/i.test(background || '')) return '#ffffff';
  const channels = background.slice(1).match(/../g).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
  const luminance = channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722;
  return (luminance+.05)/.05 >= 1.05/(luminance+.05) ? '#000000' : '#ffffff';
}
