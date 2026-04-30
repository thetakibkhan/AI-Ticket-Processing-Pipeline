# Ticket Processing System

![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![License: ISC](https://img.shields.io/badge/License-ISC-yellow)
![Tests](https://img.shields.io/badge/tests-63%20passing-brightgreen)

An async, AI-powered support ticket pipeline. Tickets submitted via REST API are queued in AWS SQS and processed by a background worker through two AI phases: triage (classification + routing) and resolution drafting. Real-time status updates are pushed to clients over Socket.io.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Real-time Events](#real-time-events-socketio)
- [Processing Pipeline](#processing-pipeline)
- [Failure Handling & Replay](#failure-handling--replay)
- [Database Schema](#database-schema)
- [Worker Configuration](#worker-configuration)
- [Scripts](#scripts)
- [Running Tests](#running-tests)
- [Contributing](#contributing)
- [License](#license)

---

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌─────────────┐
│   Client    │────▶│  Express │────▶│ PostgreSQL  │
│  (REST API) │     │   API    │     └─────────────┘
└─────────────┘     └────┬─────┘
       ▲                 │
       │ Socket.io       ▼
       │           ┌──────────┐     ┌─────────────┐
       │           │   SQS    │────▶│   Worker    │
       │           │  Queue   │     │  (Consumer) │
       │           └──────────┘     └──────┬──────┘
       │                                   │
       └───────────────────────────────────┤
                                           ▼
                                    ┌──────────────┐
                                    │  AI Adapter  │
                                    │ (Portkey AI) │
                                    └──────────────┘
                                           │ on max failures
                                           ▼
                                    ┌──────────────┐
                                    │  SQS DLQ     │
                                    └──────────────┘
```

**Request flow:**
1. `POST /tickets` creates a DB record and enqueues a message to SQS.
2. Worker polls SQS, picks up the message, and runs Phase 1 (triage).
3. On Phase 1 success, the message is re-enqueued for Phase 2 (resolution draft).
4. On Phase 2 success, ticket status is set to `completed` and clients receive a Socket.io event.
5. On failure after max retries, the ticket routes to the DLQ and status is set to `failed`.

---

## Tech Stack

| Concern | Library |
|---------|---------|
| Runtime | Node.js ≥ 20 (ES Modules) |
| Language | TypeScript 5 |
| API | Express 5 |
| Database | PostgreSQL + node-postgres |
| Queue | AWS SQS (`@aws-sdk/client-sqs`) |
| AI Gateway | Portkey AI (OpenAI-compatible) |
| Real-time | Socket.io |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- A [Portkey AI](https://portkey.ai) account with an API key and config ID

### Installation

1. **Clone and install dependencies**

   ```bash
   git clone <repo-url>
   cd ticket-processing
   npm install
   ```

2. **Start infrastructure** (PostgreSQL + LocalStack SQS)

   ```bash
   docker compose up -d
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Fill in the required values — see [Environment Variables](#environment-variables).

4. **Run migrations**

   Migrations run automatically when the PostgreSQL container starts via Docker entrypoint. SQL files in `./migrations/` execute in alphabetical order:

   | File | Purpose |
   |------|---------|
   | `001_create_tickets.sql` | `tickets` table |
   | `002_create_ticket_phases.sql` | `ticket_phases` table |
   | `003_create_ticket_events.sql` | `ticket_events` table |
   | `004_add_manual_retry_triggered_event.sql` | Adds `manual_retry_triggered` event type |

5. **Start the API server + worker**

   ```bash
   npm run dev
   ```

   The server starts on `http://localhost:3000` and the worker begins polling SQS.

---

## Environment Variables

Copy `.env.example` to `.env` and populate:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SQS_QUEUE_URL` | Yes | SQS main queue URL |
| `SQS_DLQ_URL` | Yes | SQS dead-letter queue URL |
| `PORTKEY_API_KEY` | Yes | Portkey AI API key |
| `PORTKEY_CONFIG_ID` | Yes | Portkey AI virtual key / config ID |
| `SQS_ENDPOINT` | No | Override SQS endpoint (LocalStack: `http://localhost:4566`) |
| `AWS_REGION` | No | AWS region (default: `us-east-1`) |
| `PORT` | No | Server port (default: `3000`) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |

---

## API Reference

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tickets` | List all tickets |
| `POST` | `/tickets` | Create and enqueue a new ticket |
| `GET` | `/tickets/:id` | Get ticket with phase results and event log |
| `POST` | `/tickets/:id/replay` | Replay a failed ticket from its failed phase |

---

### Create Ticket

```bash
curl -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" \
  -d '{"subject": "Cannot log in", "body": "Getting a 401 error every time I try to sign in since yesterday."}'
```

**Response `202`**
```json
{
  "ticketId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "status": "queued",
  "message": "Your ticket has been received and is being processed"
}
```

---

### Get Ticket

```bash
curl http://localhost:3000/tickets/3f2504e0-4f89-11d3-9a0c-0305e82c3301
```

**Response `200`**
```json
{
  "ticketId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "status": "completed",
  "subject": "Cannot log in",
  "body": "Getting a 401 error every time I try to sign in since yesterday.",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "phases": {
    "phase1": {
      "status": "success",
      "output": {
        "category": "technical",
        "priority": "high",
        "sentiment": "frustrated",
        "escalation": false,
        "routingTarget": "tier2",
        "summary": "User unable to authenticate since yesterday, receiving 401 errors."
      }
    },
    "phase2": {
      "status": "success",
      "output": {
        "customerReply": "Thank you for reaching out...",
        "internalNote": "Check auth service logs for token expiry issues.",
        "nextActions": ["Check auth logs", "Verify session token validity"]
      }
    }
  },
  "events": [...]
}
```

---

### Replay Failed Ticket

```bash
curl -X POST http://localhost:3000/tickets/3f2504e0-4f89-11d3-9a0c-0305e82c3301/replay
```

**Response `202`**
```json
{
  "ticketId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "status": "queued"
}
```

Returns `404` if ticket not found, `409` if ticket is not in `failed` status.

---

## Real-time Events (Socket.io)

Connect and join a ticket room to receive live processing updates:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  socket.emit('join', '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
});

// Phase started (phase1 or phase2)
socket.on('ticket.started', ({ ticketId, phase, timestamp }) => {
  console.log(`Phase ${phase} started`);
});

// Phase 1 complete, phase 2 starting
socket.on('ticket.progress', ({ ticketId, completedPhase, timestamp }) => {
  console.log(`Phase ${completedPhase} done`);
});

// Both phases complete
socket.on('ticket.completed', ({ ticketId, phase1Output, phase2Output, timestamp }) => {
  console.log('Ticket resolved', phase2Output);
});

// Routed to DLQ after max retries
socket.on('ticket.failed', ({ ticketId, reason, timestamp }) => {
  console.error('Ticket failed:', reason);
});
```

The `join` event accepts a valid UUID. Invalid IDs are silently rejected by the server.

---

## Processing Pipeline

### Phase 1 — Triage

AI analyzes the ticket and returns structured classification:

| Field | Type | Values |
|-------|------|--------|
| `category` | enum | `billing` `technical` `account` `feature_request` `other` |
| `priority` | enum | `critical` `high` `medium` `low` |
| `sentiment` | enum | `positive` `neutral` `negative` `frustrated` |
| `escalation` | boolean | — |
| `routingTarget` | enum | `tier1` `tier2` `billing_team` `engineering` `account_management` |
| `summary` | string | 10–300 chars |

### Phase 2 — Resolution Draft

AI uses the triage output to draft a response:

| Field | Type | Constraints |
|-------|------|-------------|
| `customerReply` | string | 50–2000 chars |
| `internalNote` | string | 20–1000 chars |
| `nextActions` | string[] | 1–5 items |

---

## Failure Handling & Replay

Each phase allows up to **3 attempts** with exponential backoff + jitter (max 900s delay).

**Failure conditions that skip retries immediately:**
- AI response fails Zod schema validation — retrying the same input won't produce a different result.

**DLQ routing triggers when:**
- A phase exhausts all 3 attempts.
- Phase 1 output stored in DB fails schema validation before Phase 2 starts.

**After DLQ routing:**
- Ticket status → `failed`
- A `dlq_routed` event is recorded in `ticket_events`
- Message forwarded to `SQS_DLQ_URL`

**Manual replay** via `POST /tickets/:id/replay`:
- Only works on `failed` tickets
- Resets failed phases (`status = 'started'`, `attempts = 0`)
- Records a `manual_retry_triggered` event per reset phase
- Re-enqueues the ticket
- All DB state changes are wrapped in a single transaction before the SQS enqueue

---

## Database Schema

### `tickets`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `subject` | VARCHAR | Ticket subject |
| `body` | TEXT | Ticket body |
| `status` | VARCHAR | `queued` \| `processing` \| `completed` \| `failed` |
| `created_at` | TIMESTAMP | — |
| `updated_at` | TIMESTAMP | — |

### `ticket_phases`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `ticket_id` | UUID | FK → `tickets.id` |
| `phase` | VARCHAR | `phase1` \| `phase2` |
| `status` | VARCHAR | `started` \| `progress` \| `success` \| `failure` |
| `attempts` | INTEGER | Total attempts made |
| `output` | JSONB | Phase output (null until success) |
| `started_at` | TIMESTAMP | — |
| `completed_at` | TIMESTAMP | — |

### `ticket_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `ticket_id` | UUID | FK → `tickets.id` |
| `phase` | VARCHAR | `phase1` \| `phase2` |
| `event_type` | VARCHAR | See event types below |
| `payload` | JSONB | Event-specific data |
| `created_at` | TIMESTAMP | — |

**Event types:** `phase_started` · `phase_completed` · `phase_failed` · `retry_scheduled` · `fallback_triggered` · `dlq_routed` · `manual_retry_triggered`

> Maximum 20 events returned per ticket via the API.

---

## Worker Configuration

Configured via constants in `src/workers/ticketWorker.ts`:

| Setting | Value | Description |
|---------|-------|-------------|
| `maxAttempts` | `3` | Max retries per phase |
| `pollWaitSeconds` | `20` | SQS long-poll duration |
| `shutdownTimeoutMs` | `60000` | Force-exit after SIGTERM |
| `sqsMaxDelaySeconds` | `900` | Cap on backoff delay |

The worker handles `SIGTERM` gracefully: finishes the current message then exits. A 60-second hard timeout prevents indefinite hang.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run in development mode (tsx watch) |
| `npm start` | Run compiled output from `dist/` |
| `npm test` | Run full test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

---

## Running Tests

Tests use Vitest and hit a real PostgreSQL database (no mocks for DB layer).

```bash
npm test
```

The test database is configured via `.env.test`. Infrastructure must be running (`docker compose up -d`) before executing tests.

**Test coverage includes:**
- `ticketRepo` — CRUD operations against real DB
- `phaseRepo` — phase insert, get, status transitions
- `eventRepo` — event insert and retrieval
- `ticketWorker` — full message processing flow with mocked AI and SQS
- `aiAdapter` — tool call parsing and Zod validation paths
- `emitter` — Socket.io emit with error resilience

---

## Contributing

1. Fork the repository and create a feature branch from `main`.
2. Run `npm test` — all 63 tests must pass before opening a PR.
3. Run `npx tsc --noEmit` — no type errors allowed.
4. Keep PRs focused: one concern per PR.
5. Follow existing code style — no `any` types, no `as` casts.

---

## License

ISC — see [LICENSE](./LICENSE) for details.
