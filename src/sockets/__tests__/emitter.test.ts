import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmit = vi.fn();
const mockTo = vi.fn(() => ({ emit: mockEmit }));

vi.mock('../socketServer.js', () => ({
  getIO: vi.fn(() => ({ to: mockTo })),
}));

const { emitTicketStarted, emitTicketProgress, emitTicketCompleted, emitTicketFailed } =
  await import('../emitter.js');

beforeEach(() => {
  mockEmit.mockClear();
  mockTo.mockClear();
});

describe('emitTicketStarted', () => {
  it('emits to correct room with ticketId and timestamp', () => {
    emitTicketStarted('ticket-123');
    expect(mockTo).toHaveBeenCalledWith('ticket:ticket-123');
    expect(mockEmit).toHaveBeenCalledWith(
      'ticket.started',
      expect.objectContaining({ ticketId: 'ticket-123', timestamp: expect.any(String) }),
    );
  });
});

describe('emitTicketProgress', () => {
  it('emits to correct room with completedPhase', () => {
    emitTicketProgress('ticket-123');
    expect(mockTo).toHaveBeenCalledWith('ticket:ticket-123');
    expect(mockEmit).toHaveBeenCalledWith(
      'ticket.progress',
      expect.objectContaining({ ticketId: 'ticket-123', completedPhase: 'phase1' }),
    );
  });
});

describe('emitTicketCompleted', () => {
  it('emits with phase1 and phase2 outputs', () => {
    const p1 = { category: 'technical', priority: 'high' };
    const p2 = { customerReply: 'We are looking into this.' };
    emitTicketCompleted('ticket-123', p1, p2);
    expect(mockEmit).toHaveBeenCalledWith(
      'ticket.completed',
      expect.objectContaining({ ticketId: 'ticket-123', phase1Output: p1, phase2Output: p2 }),
    );
  });

  it('handles null phase outputs without throwing', () => {
    expect(() => emitTicketCompleted('ticket-123', null, null)).not.toThrow();
    expect(mockEmit).toHaveBeenCalledWith(
      'ticket.completed',
      expect.objectContaining({ phase1Output: null, phase2Output: null }),
    );
  });
});

describe('emitTicketFailed', () => {
  it('emits with reason', () => {
    emitTicketFailed('ticket-123', 'phase1 failed after max attempts');
    expect(mockEmit).toHaveBeenCalledWith(
      'ticket.failed',
      expect.objectContaining({ ticketId: 'ticket-123', reason: 'phase1 failed after max attempts' }),
    );
  });

  it('handles empty reason string', () => {
    expect(() => emitTicketFailed('ticket-123', '')).not.toThrow();
    expect(mockEmit).toHaveBeenCalledWith(
      'ticket.failed',
      expect.objectContaining({ reason: '' }),
    );
  });
});

describe('timestamp', () => {
  it('timestamp is valid ISO string', () => {
    emitTicketStarted('ticket-123');
    const payload = mockEmit.mock.calls[0]?.[1] as { timestamp: string };
    expect(() => new Date(payload.timestamp)).not.toThrow();
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });
});

describe('room routing', () => {
  it('each ticketId routes to its own room', () => {
    emitTicketStarted('aaa');
    emitTicketStarted('bbb');
    expect(mockTo).toHaveBeenNthCalledWith(1, 'ticket:aaa');
    expect(mockTo).toHaveBeenNthCalledWith(2, 'ticket:bbb');
  });

  it('uses ticket: prefix on room name', () => {
    emitTicketStarted('xyz');
    expect(mockTo).toHaveBeenCalledWith('ticket:xyz');
    expect(mockTo).not.toHaveBeenCalledWith('xyz');
  });
});

describe('error handling', () => {
  it('does not throw if getIO throws', async () => {
    const { getIO } = await import('../socketServer.js');
    vi.mocked(getIO).mockImplementationOnce(() => { throw new Error('not initialized'); });
    expect(() => emitTicketStarted('ticket-123')).not.toThrow();
  });

  it('does not throw if emit throws', async () => {
    const { getIO } = await import('../socketServer.js');
    vi.mocked(getIO).mockImplementationOnce(() => ({
      to: () => ({ emit: () => { throw new Error('socket write error'); } }),
    }) as never);
    expect(() => emitTicketStarted('ticket-123')).not.toThrow();
  });

  it('other events still work after one emit failure', async () => {
    const { getIO } = await import('../socketServer.js');
    vi.mocked(getIO).mockImplementationOnce(() => { throw new Error('fail'); });
    emitTicketStarted('ticket-123'); // fails silently
    emitTicketProgress('ticket-123'); // must still work
    expect(mockEmit).toHaveBeenCalledWith('ticket.progress', expect.any(Object));
  });
});
