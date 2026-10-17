// node src/lib/native/installPrompt.test.mjs — when the install prompt may show.
import {
  INSTALL_KEYS, countSession, hasLoggedSomething, alreadyHandled, markShown, markDismissed, mayShowInstallPrompt,
} from './installPrompt.js';

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { console.log('  FAIL ' + msg); fails++; }
}

function store() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}
const throwing = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

const base = { native: false, standalone: false, handled: false, sessions: 1, engaged: false };

console.log('decision');
ok(!mayShowInstallPrompt(base), 'first visit, no data: hidden');
ok(mayShowInstallPrompt({ ...base, sessions: 2 }), 'second visit: may show');
ok(mayShowInstallPrompt({ ...base, engaged: true }), 'first visit with real data: may show');
ok(!mayShowInstallPrompt({ ...base, sessions: 5, native: true }), 'native app: never');
ok(!mayShowInstallPrompt({ ...base, sessions: 5, engaged: true, standalone: true }), 'already installed: never');
ok(!mayShowInstallPrompt({ ...base, sessions: 5, handled: true }), 'shown/dismissed before: never');

console.log('engagement');
ok(!hasLoggedSomething([]), 'no evidence: not engaged');
ok(!hasLoggedSomething(['profile.name', 'brainScore']), 'sign-up name + self-check alone: not engaged');
ok(hasLoggedSomething(['profile.name', 'vitalsLog']), 'a logged weigh-in: engaged');
ok(!hasLoggedSomething(null), 'bad input: not engaged');

console.log('session counting');
{
  const local = store();
  let session = store();
  ok(countSession(local, session) === 1, 'first session counts 1');
  ok(countSession(local, session) === 1, 'same session (StrictMode / reload) does not double count');
  session = store();
  ok(countSession(local, session) === 2, 'new session counts 2');
  ok(countSession(throwing, store()) === 0, 'blocked storage reads as 0 sessions');
}

console.log('remembering');
{
  const local = store();
  ok(!alreadyHandled(local), 'fresh browser: not handled');
  markShown(local, 123);
  ok(alreadyHandled(local) && local.getItem(INSTALL_KEYS.shown) === '123', 'shown is remembered (at most once)');
  const l2 = store();
  markDismissed(l2);
  ok(alreadyHandled(l2), 'dismissed is remembered');
  ok(alreadyHandled(throwing), 'blocked storage counts as handled (never nag)');
  ok(alreadyHandled(null), 'missing storage counts as handled');
  ok(markShown(throwing) === false, 'markShown survives a throwing store');
}

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log('\ninstall prompt rules: all passing');
