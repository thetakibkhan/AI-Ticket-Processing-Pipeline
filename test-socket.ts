import { io } from 'socket.io-client';

const TICKET_ID = process.argv[2];

if (!TICKET_ID) {
  console.error('Usage: node --loader ts-node/esm --no-warnings test-socket.ts <ticketId>');
  process.exit(1);
}

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('connected:', socket.id);
  socket.emit('join', TICKET_ID);
  console.log(`joined room ticket:${TICKET_ID} — waiting for events...`);
});

socket.on('ticket.started',   (d) => console.log('[started]  ', d));
socket.on('ticket.progress',  (d) => console.log('[progress] ', d));
socket.on('ticket.completed', (d) => console.log('[completed]', d));
socket.on('ticket.failed',    (d) => console.log('[failed]   ', d));

socket.on('disconnect', () => console.log('disconnected'));
socket.on('connect_error', (err) => console.error('connection error:', err.message));
