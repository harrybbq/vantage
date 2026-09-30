# Security policy

Vantage holds personal data people care about: health and sleep, meals,
weight, money, and private messages. If you've found a way to reach
data that isn't yours, we want to hear about it.

## How to report

Email **security@[your-domain]** _(placeholder — replace with the real
address before launch)_.

Please include:

- what you found and where (URL, function name, table, app screen);
- steps to reproduce it;
- what an attacker could do with it;
- whether you accessed anyone else's data while testing (see below).

Please **don't** open a public GitHub issue for a security problem.

The same contact is published at `/.well-known/security.txt`.

## What we'll do

- **Acknowledge within 3 working days** (UK working days).
- Tell you whether we can reproduce it, and roughly when a fix will ship.
- Tell you when it's fixed.
- Credit you in the hall of fame below, if you want.

There is **no paid bug bounty** yet. That may change.

## In scope

- The web app at the production domain and its Netlify functions (`/.netlify/functions/*`).
- The iOS and Android apps, once published.
- Access control on our Supabase project: reading or changing another user's data, bypassing row-level security, raising your own tier or ranking.
- Authentication, session handling, and the WHOOP / Oura / Apple Health connections.

## Out of scope

- Denial of service, load testing, or anything that degrades the service for others.
- Social engineering, phishing, or physical attacks on the owners.
- Spam or brute force against the sign-in, report or contact forms.
- Findings in third-party services themselves (Supabase, Netlify, RevenueCat, Anthropic, WHOOP, Oura). Report those to the vendor.
- Missing best-practice headers or scanner output with no working exploit.
- Anything that needs a rooted/jailbroken device or an already-compromised account.

## Safe harbour

If you make a good-faith effort to follow this policy, we will not take
legal action against you or report you to the police for your research.
Good faith means:

- use **your own accounts** (make a second one if you need two);
- access or change **only the minimum** needed to show the problem; if you reach someone else's data, stop, don't keep or share it, and tell us;
- don't degrade the service or destroy data;
- give us reasonable time to fix it before telling anyone else.

If in doubt, ask first at the address above.

## Hall of fame

People who have reported security issues responsibly. Thank you.

_No entries yet._
