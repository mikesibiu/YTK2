const test = require('node:test');
const assert = require('node:assert/strict');

const { createAccessGate } = require('../lib/accessGate');

const reqWith = cookie => ({ headers: { cookie }, secure: false });
const tokenFrom = setCookie => setCookie.split(';')[0].split('=').slice(1).join('=');

test('correct code passes, wrong codes and non-strings fail', () => {
  const gate = createAccessGate({ code: '6969', secret: 's' });
  assert.equal(gate.checkCode('6969'), true);
  assert.equal(gate.checkCode(' 6969 '), true);
  assert.equal(gate.checkCode('6968'), false);
  assert.equal(gate.checkCode(''), false);
  assert.equal(gate.checkCode(6969), false);
  assert.equal(gate.checkCode(undefined), false);
});

test('issued cookie grants access; missing, tampered and expired ones do not', () => {
  let t = 1000;
  const gate = createAccessGate({ code: '6969', secret: 's', ttlMs: 5000, now: () => t });
  const token = tokenFrom(gate.unlockCookie(reqWith('')));

  assert.equal(gate.hasAccess(reqWith(`yt2_access=${token}`)), true);
  assert.equal(gate.hasAccess(reqWith('')), false);
  assert.equal(gate.hasAccess(reqWith('yt2_access=garbage')), false);

  const [expiry, sig] = token.split('.');
  assert.equal(gate.hasAccess(reqWith(`yt2_access=${Number(expiry) + 99999}.${sig}`)), false);

  t += 6000;
  assert.equal(gate.hasAccess(reqWith(`yt2_access=${token}`)), false);
});

test('a cookie signed with another secret is rejected', () => {
  const a = createAccessGate({ code: '6969', secret: 'one' });
  const b = createAccessGate({ code: '6969', secret: 'two' });
  const token = tokenFrom(a.unlockCookie(reqWith('')));
  assert.equal(b.hasAccess(reqWith(`yt2_access=${token}`)), false);
});

test('gate is open when no code is configured', () => {
  const gate = createAccessGate({});
  assert.equal(gate.hasAccess(reqWith('')), true);
  assert.equal(gate.checkCode('anything'), false);
});

test('cookie is HttpOnly, SameSite and Secure only over https', () => {
  const gate = createAccessGate({ code: '1', secret: 's' });
  const plain = gate.unlockCookie({ secure: false });
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Lax/);
  assert.doesNotMatch(plain, /Secure/);
  assert.match(gate.unlockCookie({ secure: true }), /Secure/);
});

test('changing the code invalidates cookies issued under the old code', () => {
  const old = createAccessGate({ code: '6969', secret: 's' });
  const token = tokenFrom(old.unlockCookie(reqWith('')));
  const rotated = createAccessGate({ code: '1234', secret: 's' });
  assert.equal(old.hasAccess(reqWith(`yt2_access=${token}`)), true);
  assert.equal(rotated.hasAccess(reqWith(`yt2_access=${token}`)), false);
});
