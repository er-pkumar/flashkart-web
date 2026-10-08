# Flashkart

A flash-sale checkout service. Redis absorbs the reservation traffic, PostgreSQL
holds the durable business state, and the two are arranged so that **stock can
never be oversold**.

---

## Quick start

```bash
# 1. Install dependencies (npm workspaces — run from the repo root)
npm install

# 2. Create your .env from the template
cp .env.example .env          # Windows PowerShell: copy .env.example .env

# 3. Start PostgreSQL + Redis
npm run infra:up

# 4. Create the schema and load the flash-sale catalogue
npm run seed

# 5. Start the API (:4000) and the web app (:5173) together
npm run dev
```

Open <http://localhost:5173>.

To stop the containers: `npm run infra:down`.

---

## Prerequisites

| Tool   | Version | Notes                                                |
| ------ | ------- | ---------------------------------------------------- |
| Node   | 20+     | `node -v`                                            |
| Docker | any     | For PostgreSQL + Redis. Docker Desktop must be open. |

If you already run PostgreSQL and Redis locally, skip `npm run infra:up` and
point `DATABASE_URL` / `REDIS_URL` in `.env` at your own instances.

---

## Commands

Run all of these from the repo root.

| Command              | What it does                                                   |
| -------------------- | -------------------------------------------------------------- |
| `npm run dev`        | API and web app together                                        |
| `npm run dev:api`    | API only, on <http://localhost:4000>                            |
| `npm run dev:web`    | Web app only, on <http://localhost:5173>                        |
| `npm run seed`       | Resets products, orders and all Redis keys, then reloads stock  |
| `npm run build`      | Type-checks and builds both apps                                |
| `npm run infra:up`   | Starts the PostgreSQL and Redis containers                      |
| `npm run infra:down` | Stops them                                                      |

The schema is created automatically on API start (TypeORM `synchronize` in
development). `npm run seed` is what gives you products to buy — without it the
catalogue is empty.

### Docker commands

`npm run infra:up` / `infra:down` are thin wrappers. The direct equivalents:

```bash
docker compose up -d               # start PostgreSQL + Redis
docker compose ps                  # check both are healthy
docker compose logs -f postgres    # tail a container
docker compose down                # stop
docker compose down -v             # stop and wipe the data volumes
```

Only PostgreSQL and Redis run in Docker. The API and web app run on the host via
`npm run dev`.

Opening a shell on either container:

```bash
docker exec -it flashkart-postgres psql -U flashkart -d flashkart
docker exec -it flashkart-redis redis-cli
```

---

## Verifying the setup

After `npm run seed` and `npm run dev`, these four checks confirm the whole
stack is wired up:

```bash
# 1. API is alive
curl localhost:4000/health
# {"status":"ok"}

# 2. Catalogue is loaded (5 products, with live availability)
curl localhost:4000/api/products

# 3. Durable state landed in PostgreSQL
docker exec flashkart-postgres psql -U flashkart -d flashkart \
  -c "select name, stock, total_stock from products order by stock;"

# 4. Redis counters were primed from that stock
docker exec flashkart-redis redis-cli --scan --pattern "fk:stock:*"
```

Then open <http://localhost:5173>, reserve an item and buy it. Stock should drop
in both the UI and in the two queries above.

---

## Layout

```
flashkart/
├── apps/
│   ├── api/                  Node.js + Express + TypeORM
│   │   └── src/
│   │       ├── controllers/  HTTP only: parse, delegate, respond
│   │       ├── services/     All business logic
│   │       ├── entities/     Product, Order
│   │       ├── redis/        Client + atomic Lua reservation scripts
│   │       ├── jobs/         Expired-reservation sweeper
│   │       └── middleware/   Auth stand-in, error mapping
│   └── web/                  React + Vite
├── docker-compose.yml        PostgreSQL 16 + Redis 7
└── .env.example
```

Services own the business rules; controllers stay thin and do no logic. There is
no repository layer — TypeORM repositories and the `EntityManager` already are
that layer, so wrapping them again would add indirection without adding value.

---

## How overselling is prevented

This is the requirement everything else bends around. Stock is guarded at three
independent levels, so a bug at one level cannot oversell by itself.

**1. Redis is the admission gate (fast path).**
Each product has a counter, `fk:stock:<productId>`. Reserving runs a Lua script
that checks the counter and decrements it **in one atomic step** inside Redis.
Lua execution is single-threaded, so there is no window between the check and
the decrement — ten thousand concurrent buyers draw down the same counter and
exactly `stock` units are ever handed out. Everyone else gets `409 SOLD_OUT`
without ever touching PostgreSQL.

### Why the Lua script removes the race

The naive version is a read, a decision, and a write as three separate commands:

```
GET  fk:stock:p1   -> 1      # request A reads 1
GET  fk:stock:p1   -> 1      # request B reads 1 too
DECRBY fk:stock:p1 1         # A commits
DECRBY fk:stock:p1 1         # B commits -> counter is now -1, one unit oversold
```

Both requests read the same value before either wrote, so both believed they had
won. This is a classic check-then-act race, and no amount of application-side
locking in Node fixes it once several API instances are involved.

`EVAL` closes the gap. Redis runs commands on a single thread and executes a
whole script as **one indivisible unit** — no other client command can be
interleaved into the middle of it. So the check and the decrement happen with
nothing in between:

```lua
local available = redis.call('GET', KEYS[1])
if not available then return -1 end            -- counter not primed
if tonumber(available) < quantity then
  return 0                                      -- sold out: nothing written
end
redis.call('DECRBY', KEYS[1], quantity)         -- only reachable if stock exists
redis.call('HSET',   KEYS[2], ...)              -- reservation record
redis.call('PEXPIRE',KEYS[2], ttl)              -- 5 minute hold
redis.call('ZADD',   KEYS[3], expiresAt, id)    -- expiry index for the sweeper
return 1
```

Either a request passes the check and gets its decrement plus its reservation,
or it fails the check and nothing at all is written. The counter can never go
negative, so it cannot hand out a unit that does not exist. Two buyers racing
for the last unit are resolved by whichever script Redis happens to run first;
the other sees `0` and gets `409 SOLD_OUT`.

The same property is why the three writes that follow the decrement are safe:
decrementing stock, recording the reservation and indexing its expiry either all
happen or none do. A crash between them is not possible.

Returning a status code rather than raising lets the service map outcomes to
meaningful errors: `1` reserved, `0` sold out, `-1` sale not primed, `-2`
duplicate reservation id.

Reservations are held for `RESERVATION_TTL_SECONDS` (default **300s / 5 min**).
The hash itself is given a slightly longer Redis TTL than that, so the sweeper
can still read the quantity it needs to credit back.

**2. PostgreSQL is the source of truth (durable path).**
Checkout decrements stock with a conditional update:

```sql
UPDATE products SET stock = stock - $1
 WHERE id = $2 AND stock >= $1
RETURNING price_cents
```

PostgreSQL re-evaluates `stock >= $1` *after* taking the row lock, so concurrent
checkouts serialise on that row and the loser gets zero rows affected — reported
as `409 SOLD_OUT`. No `SELECT ... FOR UPDATE` dance, no application-level
locking, no lost updates.

**3. A CHECK constraint is the backstop.**
`CHECK (stock >= 0)` on `products`. If every layer above it were broken,
PostgreSQL would still refuse to record the oversell.

### Reservations expire without losing stock

A Redis key expiring would take its quantity with it and the counter would never
be credited back. So each reservation is also tracked in a sorted set keyed by
expiry, and a sweeper (every 2s) returns abandoned units to the counter.

Before crediting anything back, the sweeper asks PostgreSQL whether that
reservation already became an order. This is what makes the ordering in checkout
safe: the transaction commits **first**, and only then is the Redis reservation
consumed. If that Redis call fails, the order is already durable, and the sweeper
sees it and leaves the counter alone.

### How duplicate orders are prevented

Checkout is `POST /api/order/checkout` and carries an `Idempotency-Key` header.
Four mechanisms stack up, because a retry can arrive at any point in the flow:

**1. Replay check before any work.** The first thing checkout does is look for an
order with this idempotency key. Found means this is a retry, so the existing
order is returned with `replayed: true` and nothing is written.

**2. A unique index, not a read.** The check above is a race on its own — two
simultaneous retries both read "no order" and both proceed. What actually makes
it safe is `uq_orders_idempotency_key`. The second inserter **blocks on the
index** until the first transaction commits or rolls back, then raises
`23505`. Checkout catches that, re-reads by idempotency key, and returns the
winner's order. Because the block outlasts the commit, the winning row is always
readable by then, so the loser never has to guess.

**3. One reservation, one order.** `uq_orders_reservation_id` makes a hold
spendable exactly once, which covers the case of two requests sharing a
reservation but sending *different* idempotency keys. The loser rolls back —
stock decrement included — and gets `409 RESERVATION_ALREADY_USED`.

**4. The reservation disappears when spent.** Redis consume happens after the
commit, so a later attempt finds no hold. If the reservation is gone, checkout
re-checks the idempotency key before concluding anything: consume only ever
follows a successful commit, so a missing hold means the order exists and can be
returned. Without this step a slow retry would get a spurious `410`.

Everything in step 3 and the decrement itself sit inside one
`AppDataSource.transaction`, so stock, order and line item commit together or
not at all.

Verified: 12 concurrent checkouts with one idempotency key produce `1 × 201` and
`11 × 200`, exactly one `orders` row, one `order_items` row, and stock down by
exactly the reserved quantity.

### Releasing the hold when checkout fails

The transaction rolls back on failure, so durable stock is never touched. The
only open question is what the Redis counter should say, and the two failure
classes need opposite answers:

| Failure | Action | Why |
| --- | --- | --- |
| `SOLD_OUT` (durable stock exhausted) | drop the hold, do **not** credit back | The counter was ahead of Postgres. Returning the units would re-offer stock that does not exist. |
| Anything else (dropped connection, unexpected constraint) | credit the units back | Nothing was sold, so put them on sale again instead of waiting out the 5 minute expiry. |
| `RESERVATION_ALREADY_USED` | leave it alone | Another order owns those units. |

Cleanup failures are logged, never thrown — they must not mask the original
error, and the sweeper reclaims the hold at expiry regardless.

### Checkout is idempotent

`POST /api/checkout` requires an `Idempotency-Key` header, stored on the order
under a unique index. A retried request returns the original order with
`replayed: true` instead of buying twice. `orders.reservation_id` is unique too,
so a single reservation is spendable exactly once even if two requests race with
different idempotency keys — the losing transaction rolls back, taking its stock
decrement with it.

The web app mints one idempotency key per reservation, so clicking "Buy now"
twice, or retrying after a timeout, is always safe.

---

## API

Every endpoint except `/api/products` needs an `x-user-id` header. That is a
deliberate stand-in for real authentication — swapping it for JWT verification
would not change a single service.

| Method   | Path                    | Purpose                          |
| -------- | ----------------------- | -------------------------------- |
| `GET`    | `/health`               | Liveness                         |
| `GET`    | `/api/products`         | Catalogue with live availability  |
| `POST`   | `/api/cart/reserve`     | Hold units for 5 min (Redis)     |
| `DELETE` | `/api/reservations/:id` | Release a hold early             |
| `POST`   | `/api/order/checkout`   | Convert a hold into an order     |
| `GET`    | `/api/orders`           | The orders belonging to a caller |

### Walking the flow with curl

```bash
# List products and copy an id
curl localhost:4000/api/products

# Hold 2 units
curl -X POST localhost:4000/api/cart/reserve \
  -H "content-type: application/json" \
  -H "x-user-id: alice" \
  -d "{\"productId\":\"<PRODUCT_ID>\",\"quantity\":2}"

# Buy them. Re-run this exact command — you get the same order back, not a second one.
curl -X POST localhost:4000/api/order/checkout \
  -H "content-type: application/json" \
  -H "x-user-id: alice" \
  -H "Idempotency-Key: demo-key-1" \
  -d "{\"reservationId\":\"<RESERVATION_ID>\"}"

curl localhost:4000/api/orders -H "x-user-id: alice"
```

### Error codes

| Code                       | Status | Meaning                                 |
| -------------------------- | ------ | --------------------------------------- |
| `SOLD_OUT`                 | 409    | Not enough stock                        |
| `RESERVATION_EXPIRED`      | 410    | Hold expired or was already used        |
| `RESERVATION_ALREADY_USED` | 409    | That reservation is already an order    |
| `MISSING_IDEMPOTENCY_KEY`  | 400    | Checkout sent without the header        |
| `SALE_NOT_READY`           | 503    | Counter not primed — run `npm run seed` |

---

## Seeing the guarantee for yourself

"Lumen 4K Monitor" is seeded with **5** units. Fire 50 concurrent reservations
at it and count the winners:

```bash
PRODUCT_ID=<lumen-id>
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/api/cart/reserve \
    -H "content-type: application/json" -H "x-user-id: user-$i" \
    -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}" &
done | sort | uniq -c
```

You get exactly five `201`s and forty-five `409`s, every time.

---

## Configuration

| Variable                       | Default | Purpose                                      |
| ------------------------------ | ------- | -------------------------------------------- |
| `PORT`                         | `4000`  | API port                                     |
| `DATABASE_URL`                 | —       | PostgreSQL connection string (required)      |
| `REDIS_URL`                    | —       | Redis connection string (required)           |
| `RESERVATION_TTL_SECONDS`      | `120`   | How long a hold survives before being swept  |
| `MAX_QUANTITY_PER_RESERVATION` | `5`     | Per-reservation cap, for flash-sale fairness |

---

## Design documents

System-design write-ups live in [docs/](docs/README.md):

- [C1. High-concurrency design](docs/c1-high-concurrency.md) — 10,000 req/sec:
  load balancing, Redis, database optimization, horizontal scaling, diagram
- [C2. Data consistency](docs/c2-data-consistency.md) — oversell prevention, why
  Redis holds reservations, eventual consistency, failure recovery
- [D1. Overselling post-mortem](docs/d1-overselling.md) — stock 100 vs orders 120:
  root cause, diagnostic queries, fix, and cleaning up the bad orders
- [D2. Duplicate checkout](docs/d2-duplicate-checkout.md) — why a page refresh
  cannot create a second order, and why the idempotency key alone would not stop it

---

## Known trade-offs

Deliberate scope choices, called out so they are not mistaken for oversights:

- **`synchronize: true` in development.** A real deployment would run generated
  migrations; it is off when `NODE_ENV=production`.
- **Header-based identity.** No auth, no sessions, no payment capture — checkout
  records the order and stops there.
- **The counter can drift low, never high.** If Redis loses data or the sweeper
  is down longer than the 60s grace period, the units held by a reservation can
  go missing from the Redis counter while remaining in PostgreSQL. The result is
  *under*-selling, which the next `npm run seed` resets. Overselling stays
  impossible because PostgreSQL, not Redis, decides every sale.
