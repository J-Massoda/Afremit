# Afremit pilot

Afremit is a South African company exploring a clearer way for people abroad to support specific services provided in Africa. A parent might receive a private school fee request, review its student reference, and follow it until the school confirms how the payment was allocated. A family could use a similar process for a clinic estimate, or a project owner for a construction milestone.

**This repository is a working pilot with simulated payments.** It accepts no money and has no live bank, crypto, insurance, or escrow integration. "Held," "allocated," and "refunded" describe test ledger states only. Pilot approval means permission to test software; it is not a financial or institutional certification.

## Review this update

- Afremit's supplied transparent logo replaces the temporary text mark across the public site and pilot workspace.
- White, navy (`#00246E`), bright blue (`#4985FF`), and pale blue now define the public site and workspace.
- New public content explains provider, payer, and Afremit reviewer examples; a partner/investor overview; and a pilot FAQ. These pages describe a simulated workflow, not live payments or an active escrow service.
- No migration or backend contract changed in this design and content update.

## What works

- A responsive public site led by the education journey, with healthcare and construction pathways, clear school/payer/reviewer examples, a partner overview, pilot FAQ, tailored editorial imagery, and a scroll-controlled SVG process map.
- A local demo with fictional payer, school, clinic, construction, and Afremit reviewer accounts. Actions persist in `.data/local.json` on your machine.
- Connected pilot sign-up/sign-in through a **new Afremit Supabase project**, authenticated server-side for every private API call.
- Applications for all three provider types; an Afremit reviewer can approve or decline pilot access.
- A provider can create a single private fee/service/milestone request without building a full catalogue. The request has a hard-to-guess share code.
- A payer can review the request, create a test transaction, simulate the held state, raise an exception, and see the audit history.
- A provider can confirm allocation. An incorrect amount or reference requires manual review first. An Afremit reviewer can simulate a refund while test value is still held.
- A double-entry test ledger and idempotent actions. The admin dashboard counts real applications/requests separately from test payments, with real money volume fixed at zero.
- A local text helper suggests an amount/reference from pasted text. It sends nothing to an AI API; staff must check its output. Document upload, OCR, and paid AI services are **not** part of this release.

## Run locally

Requires Node.js 20 or newer. No package installation or API key is needed for the local demo.

```sh
npm run dev
```

Open `http://localhost:8788`, then **Open pilot**. Choose a fictional account. Use the school account to inspect its example fee request, then sign out and use the payer account with `SAMPLE-SCHOOL-2026` to start a test transaction. Return as the school to confirm allocation, and as Afremit to inspect the review queue. Test a mismatch by changing the entered reference or amount.

The local server persists changes in `.data/local.json`. Delete that file to restore only fictional examples. No live provider or payout is contacted.

```sh
npm test
npm run build
```

`npm run build` copies the public frontend to `dist/`. The Pages Functions in `functions/` are deployed by Cloudflare separately.

## Connect a real pilot database

Create a **separate** Supabase project for Afremit. Never reuse Citebid's database or credentials. In the Supabase SQL Editor, run [`sql/001_pilot.sql`](sql/001_pilot.sql). Enable email authentication and email confirmation in the Supabase Auth settings. Register your own Afremit account, confirm its email, then promote only that account in the SQL Editor:

```sql
update public.profiles set role='admin' where email='YOUR_ACTUAL_EMAIL';
```

The project has no public database write permission: browser accounts authenticate through Supabase Auth, while Cloudflare Functions validate their tokens and perform authorized operations using a server-only key. In Cloudflare Pages, set these environment variables for **each environment where connected pilot sign-in should work**:

| Variable | Where it comes from | Exposure |
| --- | --- | --- |
| `SUPABASE_URL` | Afremit Supabase Project Settings → API | Server and public auth configuration |
| `SUPABASE_ANON_KEY` | Project publishable/anon key | Public auth configuration |
| `SUPABASE_SERVICE_ROLE_KEY` | Project service-role or secret key | **Cloudflare server secret only; never in frontend, Git, or a screenshot** |

If your Supabase dashboard labels its keys `sb_publishable_...` and `sb_secret_...`, use those corresponding values. The backend sends the new secret key in Supabase's `apikey` header; it is not a JWT. The key must never be stored in `public/` or a `VITE_` variable. Set the Supabase Auth Site URL and permitted redirect URLs to the eventual pilot origin; this pilot uses password sign-in, not OAuth redirects.

With no Supabase configuration, a Cloudflare preview can show the public site, but the connected pilot screen accurately reports that setup is incomplete. Local demo accounts **never work on a remote deployment**.

### Before inviting real pilot users

Use only the minimum data needed for a guided test. Do not enter patient records, children's names, government IDs, card numbers, bank details, or real payment instructions. Decide and publish the contact address, privacy notice, deletion process, data retention, terms for pilot participation, and who can approve institutions. Review the product language and agreements with the founder. The software does not grant Afremit permission to move or hold money.

## Cloudflare deployment after local review

The recommended structure is **one Cloudflare Pages project** at first:

- `afremit.com`: public story and `/#app` pilot entry once you choose to launch.
- Before connecting the domain, use a `*.pages.dev` preview from a review branch. Connect a dedicated Afremit Supabase project only when you want real pilot registrations.
- If the pilot later needs a distinct origin, `pilot.afremit.com` can point to a separately configured Pages project built from the same repository. Keep an explicit boundary between public production and pilot data rather than duplicating a live-looking site with test accounts.

In Cloudflare Pages, select the GitHub repository and set **Root directory** to the repository root (leave the field blank), **Build command** to `npm run build`, and **Build output directory** to `dist`. Pages Functions live under `functions/` at the repository root. For preview branches, keep a separate Supabase project or branch and separate secrets from production. Configure the custom domain in Cloudflare and adjust Namecheap DNS only **after** reviewing and testing the deployment.

This project does not include an automatic GitHub Pages workflow because its connected private API requires a server runtime. A static GitHub Pages deployment would show only the public site and could not securely run pilot transactions.

## Technical map

| Location | Purpose |
| --- | --- |
| `public/` | Public website and role-specific pilot interface; no service secrets |
| `functions/api/[[path]].js` | Cloudflare Pages API entry point |
| `src/api.mjs` | Authenticated request routing and access checks |
| `src/supabase.mjs` | Supabase persistence via server-side REST and atomic RPC functions |
| `src/memory.mjs` | Local fictional data and workflow for offline testing |
| `src/domain.mjs` | Shared validation, states, and test ledger rules |
| `sql/001_pilot.sql` | Schema, row-level security, audit triggers, and atomic transaction procedures |
| `tests/` | Permission, state, idempotency, mismatch, and ledger tests |

## Important boundaries

- Provider pilot approval is a human review decision. No real provider verification or KYC integration is claimed.
- Payer origin currency is recorded, but the pilot does **not** quote a real FX conversion or fee.
- The test ledger is an escrow *workflow simulator*. It is not a bank account, real escrow account, or custody product.
- No insurance protection, guaranteed settlement, live pay-in/payout, card collection, stablecoin conversion, or government institution integration is active.
- The hosted Supabase path is prepared but cannot be end-to-end tested until the Afremit project and Cloudflare secrets are provisioned. Local workflow and API tests do run without them.

This repository is intended to stand alone under a new name such as `afremit-pilot`. The older `Afremit-function` repository and its Vercel/WhatsApp deployments are not used by this project. Do not point the old deployment at this new project.

### Logo asset

The public site and pilot workspace use the transparent Afremit logo provided by the founders (`public/assets/afremit-logo.png`). The UI uses its navy `#00246E` and blue `#4985FF` with white and pale blue surfaces. This 256 × 256 image is suitable for the current pilot; request a vector or larger master asset if one becomes available before making large-format materials.
