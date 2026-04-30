import { io } from 'socket.io-client';

const args = process.argv.slice(2);

// Mode A: watch existing ticket  →  test-socket.ts <ticketId>
// Mode B: create + watch         →  test-socket.ts --create <subject> <body>
const createMode = args[0] === '--create';

async function post(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

const socket = io('http://localhost:3000');

socket.on('connect', async () => {
  console.log('connected:', socket.id);

  let ticketId: string;

  if (createMode) {
    const subject = args[1] ?? '';
    const body    = args[2] ?? '';
    if (!subject || !body) {
      console.error('Usage: test-socket.ts --create <subject> <body>');
      process.exit(1);
    }

    // Create + enqueue in one shot, then join room
    const created = await post('/tickets', { subject, body }) as { ticketId: string };
    ticketId = created.ticketId;
    console.log('ticketId:', ticketId);

    await socket.emitWithAck('join', ticketId);
    console.log(`joined room ticket:${ticketId} — waiting for events...`);
  } else {
    ticketId = args[0] ?? '';
    if (!ticketId) {
      console.error('Usage: test-socket.ts <ticketId>');
      process.exit(1);
    }
    await socket.emitWithAck('join', ticketId);
    console.log(`joined room ticket:${ticketId} — waiting for events...`);
  }
});

socket.on('ticket.started',   (d: { phase: string; timestamp: string }) =>
  console.log(`${d.timestamp}  ${d.phase} started`));
socket.on('ticket.progress',  (d: { completedPhase: string; timestamp: string }) =>
  console.log(`${d.timestamp}  ${d.completedPhase} completed`));
socket.on('ticket.completed', (d: { timestamp: string }) =>
  console.log(`${d.timestamp}  ticket completed`));
socket.on('ticket.failed',    (d: { reason: string; timestamp: string }) =>
  console.log(`${d.timestamp}  ticket failed: ${d.reason}`));

socket.on('disconnect', () => console.log('disconnected'));
socket.on('connect_error', (err) => console.error('connection error:', err.message));
