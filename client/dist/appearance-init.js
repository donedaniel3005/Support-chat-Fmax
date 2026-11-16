(function () {
  var preference = 'system';
  try { preference = localStorage.getItem('support-appearance') || 'system'; } catch (_) {}
  if (['light','dark','system'].indexOf(preference) === -1) preference = 'system';
  var mode = preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.appearance = mode;
  document.documentElement.style.colorScheme = mode;
}());
