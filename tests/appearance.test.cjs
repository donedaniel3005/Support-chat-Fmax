const { test } = require('node:test');
const assert = require('node:assert/strict');
test('appearance respects explicit modes, follows system only when selected, and recovers invalid preferences', async () => {
  const { validPreference, resolveAppearance } = await import('../client/src/appearance-model.mjs');
  assert.equal(resolveAppearance('light', true), 'light');
  assert.equal(resolveAppearance('dark', false), 'dark');
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
  assert.equal(validPreference('broken'), 'system');
  assert.equal(resolveAppearance(null, true), 'dark');
});

test('interface text and focus palettes maintain readable contrast in both modes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../client/src/appearance.css'), 'utf8');
  const blocks = [css.match(/:root\s*\{([^}]+)\}/)[1], css.match(/:root\[data-appearance="dark"\]\s*\{([^}]+)\}/)[1]];
  function luminance(hex) {
    const channels = hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  }
  function contrast(a,b) { const values = [luminance(a),luminance(b)].sort((x,y)=>y-x); return (values[0]+.05)/(values[1]+.05); }
  for (const block of blocks) {
    const tokens = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[a-f0-9]{6})/gi)].map(match => [match[1],match[2]]));
    for (const text of ['--ui-text','--ui-muted']) for (const surface of ['--ui-bg','--ui-surface','--ui-soft']) assert.ok(contrast(tokens[text],tokens[surface]) >= 4.5, `${text} on ${surface} needs 4.5:1 contrast`);
    assert.ok(contrast(tokens['--ui-focus'],tokens['--ui-bg']) >= 3, 'Focus outline needs 3:1 contrast');
    assert.ok(contrast(tokens['--ui-on-accent'],tokens['--ui-accent']) >= 4.5, 'Accent text needs 4.5:1 contrast');
  }
});

test('custom launcher colors choose readable foregrounds', async () => {
  const { readableText } = await import('../client/src/appearance-model.mjs');
  assert.equal(readableText('#ffffff'), '#000000');
  assert.equal(readableText('#000000'), '#ffffff');
  assert.equal(readableText('#ff0000'), '#000000');
  assert.equal(readableText('#15803d'), '#ffffff');
  assert.equal(readableText('invalid'), '#ffffff');
});
