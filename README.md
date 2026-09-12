# Vapi concurrency gateway

Give each of your clients their own concurrent-call limit, so one client's
traffic spike cannot eat the capacity you sold to everyone else.

If you resell Vapi, you buy concurrency as a pool. Your clients experience it
as a free-for-all: whoever dials first gets the lines. This is a small service
that sits in front of Vapi and hands each client a fixed slice.

![The gateway admitting and rejecting calls](docs/demo.gif)

Acme is filled to its cap of 5, so the next call is turned away before it
starts. A line is freed, and the call after that gets through.

```text
inbound call  ->  Vapi assistant-request  ->  reserve a slot  ->  assistant, or reject
call ends     ->  Vapi status-update      ->  release the slot
outbound dial ->  POST /api/dial          ->  reserve a slot  ->  Vapi POST /call
```

## Why a call is rejected rather than queued

An over-cap inbound call never starts an assistant. No model, no voice, no
transcriber, so it costs nothing but the carrier leg. The caller hears your
client's own message and hangs up.

That is the right answer for inbound, because someone is holding a phone and
there is nothing to queue. It is not the only answer for outbound. Vapi's V2
campaigns already pace themselves: `maxConcurrency` defaults to 10, caps at
500, cannot exceed your org limit, and calls that will not fit are retried for
up to an hour as capacity frees.

Campaign pacing does not replace this service, because the budget is per
campaign. Two campaigns for the same client run at twice its slice, and a
campaign cannot see inbound calls at all. Use both:

| | Handled by |
| --- | --- |
| Pacing one outbound list, with retries | A V2 campaign, `maxConcurrency` |
| One client's total across every campaign | This gateway |
| Inbound | This gateway |

## The one constraint that matters

**Inbound numbers must be bare.** Do not attach an assistant, squad, or
workflow directly to a phone number you want governed. Vapi only sends
`assistant-request` when it needs someone to choose the assistant, and a number
with an assistant already on it never asks. The call connects, the cap is
never consulted, and nothing appears to be wrong.

For each inbound number:

1. Remove its direct assistant, squad, or workflow assignment.
2. Point `server.url` at `https://your-service/vapi/webhook`.
3. Set `server.secret` to the same value as your `WEBHOOK_SECRET`.
4. Map its Vapi phone-number ID to a tenant in `TENANTS_JSON`.

## Run it

Node 22 and Postgres. Nothing else.

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL, VAPI_API_KEY, WEBHOOK_SECRET, TENANTS_JSON
createdb vapi_concurrency
npm run migrate
npm run seed
npm run dev                   # http://localhost:3002
```

`.env` is gitignored and read through Node's native `--env-file`, so there is
no dotenv dependency. The schema is applied on startup and is idempotent.

`npm test` runs against a real Postgres, pointed at by `.env.test`. Use a
throwaway database: the helper truncates every table between tests. The tests
use a real database on purpose, because the guarantee below depends on genuine
row locking rather than an emulator's impression of it.

## Deploying

Anywhere that runs Node and reaches a Postgres. There is nothing
platform-specific in the code, and no platform SDK in the dependency tree.

```bash
npm run build && npm start
```

The reference deployment is Railway, purely because it was convenient. Fly,
Render, ECS, Cloud Run, or a VM behind nginx all work the same way. Set the
environment variables, expose the port, make sure `server.url` on your Vapi
numbers points at the running instance.

Note the service keeps reservation state in Postgres, not in memory, so you can
run more than one instance behind a load balancer. The cap holds across them,
because the lock that enforces it is a database row lock rather than a process
lock. The one exception is demo mode, which keeps its cycle timer in memory and
is meant for a single instance.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string. |
| `WEBHOOK_SECRET` | Yes | Must equal the Vapi `server.secret`. |
| `TENANTS_JSON` | Yes, to seed | Your tenants, one line of JSON. |
| `VAPI_API_KEY` | For outbound | Private Vapi API key. |
| `PORT` | No | Defaults to `3002`. |
| `ENABLE_RECONCILIATION` | No | `true` turns on the missed-webhook safety net. |
| `DEMO_MODE` | No | `true` mounts the presenter controls. Never in production. |

## Tenants

```json
[
  {
    "id": "client-a",
    "displayName": "Client A",
    "cap": 5,
    "phoneNumberIds": ["your-vapi-phone-number-id"],
    "assistantIds": ["your-vapi-assistant-id"],
    "voiceId": "Elliot"
  }
]
```

Put that in `TENANTS_JSON` and run `npm run seed`, then again whenever you
change a cap or a mapping. Both ID fields are arrays because a client may own
several numbers or assistants. `assistantIds` matters only for outbound.

Caps are enforced per tenant and nothing here manages billing, so it is on you
to keep the total at or under the concurrency you actually bought.

## HTTP API

**`POST /api/dial`** starts an outbound call.

```json
{
  "tenantId": "client-a",
  "phoneNumberId": "your-vapi-phone-number-id",
  "assistantId": "one-of-that-tenant's-assistant-ids",
  "customerNumber": "+15551234567"
}
```

`201` with a Vapi `callId`, or `429` when the client is at its cap. This route
has no authentication of its own by design, since you already have an auth
system and guessing at one would be worse than leaving the seam visible. Put
yours in front of it before exposing it.

**`GET /api/state`** returns tenants, active slots, and recent events. Open, so
a static dashboard can render it.

**`POST /vapi/webhook`** is where Vapi sends `assistant-request` and
`status-update`. Guarded by `WEBHOOK_SECRET`.

## How the cap is actually enforced

`reserve` takes a `SELECT ... FOR UPDATE` row lock on the tenant, counts inside
the same transaction, and inserts only if there is room. The lock is what makes
this a cap rather than a race: without it, ten simultaneous calls all read the
same count and all get admitted. There is a test that fails without it.

**The invariant to preserve if you change anything here: a slot is released
only on proof a call ended, never on absence of proof.** A Vapi read returning
not-found means "this call has not appeared yet" at least as often as it means
"this call is over", and treating those the same frees a line out from under a
live conversation. Every release path is written around that.

Lowering a cap below current usage is allowed and does not cut anyone off. The
tenant drains, which falls out of the `used >= cap` check for free.

## Where to read

1. `src/db/schema.sql`, the states a reservation moves through
2. `src/admission.ts`, the transaction that enforces the cap
3. `src/routes/webhook.ts`, where an inbound call meets it
4. `src/routes/dial.ts`, the outbound side

That is the whole gateway. Everything else is a dashboard, a seed script, or
one of the two optional modules below.

## Optional: reconciliation

Off unless `ENABLE_RECONCILIATION=true`. The normal release is Vapi's terminal
`status-update`. This background worker also polls held calls and releases one
only when Vapi explicitly reports `ended`. A safety net for a dropped webhook,
not part of the core idea. Lives in `src/optional/reconciler.ts`.

## Optional: demo mode

Off unless `DEMO_MODE=true`, which is what the GIF above is running. It lets
you fill a tenant's lines without dialling real phones, end those calls one at
a time, and change a cap from the dashboard.

It is not a way around the cap. Simulated calls go through the same `reserve`
the webhook uses, take the same lock, and are refused at the cap like anything
else. They carry a `sim_` ID, every statement in `src/demo/` is scoped to that
prefix, and the end-call route refuses an ID without it, so none of it can
touch a live call.

A filled tenant cycles, holding at its cap for 25 seconds and leaving a line
free for 12 (`DEMO_HOLD_MS`, `DEMO_FREE_MS`). The hold is the long half
deliberately: at cap is the state worth explaining, and the gap is where you
place a real call to show it getting through.

The more convincing version needs no simulation at all. Set a client's cap to
1 and call its number from two phones. The first connects. The second does not.

Delete `src/demo/` and `src/routes/demo.ts` to remove all of it. Nothing else
imports either one.

## License

MIT.
