# Explaining `+server.ts`

This file is the **front door** to the microcontroller. It "knocks" on the door every 30 seconds. It receives a sensor reading, checks that it's trustworthy, and writes it to the database. That's its entire job.

---

## What problem it solves

The database cannot be exposed directly to the internet — anyone could write garbage data to it. This file acts as a gatekeeper: only authenticated, validated readings get through.

---

## The four things it does in order

**1. Checks identity (authentication)**

Before looking at the data at all, it checks the `x-api-key` header against a secret stored in your server environment. If the key is wrong or missing, the request is rejected immediately with a `401 Unauthorized` — nothing else runs.

This key is stored in Vercel's environment variables, never in source code. The microcontroller has it hardcoded in its firmware.

**2. Parses the incoming data**

The microcontroller sends a small JSON payload:

```json
{
	"tank_id": "tank-1",
	"sensor_id": "sensor-1",
	"type": "temperature",
	"value": 21.4,
	"unit": "°C"
}
```

The file parses this from the raw HTTP request body.

**3. Validates the data (two levels)**

- **Structural** — are all required fields present and the right data type? Missing `tank_id`? Rejected. `value` is a string instead of a number? Rejected.
- **Range** — is the value physically plausible?
  - Temperature must be between −2°C and 45°C
  - pH must be between 3 and 14
  - CO₂ must be between 0 and 200 mg/L
  - A reading outside these bounds means the probe is faulty or the firmware has a bug — reject it before it corrupts the database

**4. Writes to the database**

If everything passes, one row is inserted into `sensor_readings`. The response is `201 Created` with the new row's ID.

---

## What it deliberately does NOT do

- It does not run CarbSys calculations — that happens later, either in the store when the browser receives the data, or as a separate background process
- It does not send data to the browser — that's the SSE route's job
- It does not accept GET requests — the microcontroller only POSTs; a `GET /api/ingest` returns `405 Method Not Allowed`

---

## The flow in one picture

```
ESP32 firmware
    │
    │  POST /api/ingest
    │  x-api-key: secret
    │  { tank_id, sensor_id, type, value, unit }
    ▼
+server.ts
    ├── ❌ wrong key       → 401
    ├── ❌ missing fields  → 400
    ├── ❌ value out of range → 400
    └── ✅ all good        → INSERT into sensor_readings → 201
```

---

## The one line that changes in production

Currently the DB write is commented out and replaced with a mock ID so the endpoint works immediately without a database:

```ts
// MOCK — works now, no DB needed
const insertedId = `mock-${Date.now()}`;

// PRODUCTION — uncomment this block, delete the mock line
const inserted = await db.insert(sensorReadings).values({ ... });
```

Everything else — authentication, validation, error handling, the response format — is production-ready as written.
