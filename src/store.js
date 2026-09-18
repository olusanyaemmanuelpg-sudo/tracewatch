import fs from 'fs';
import path from 'path';

/**
 * EventStore manages the local high-performance log retention layer.
 * Implements a strict circular ring buffer to prevent out-of-memory crashes.
 */

export class EventStore {
  /**
   * @param {number} [maxSize=50000] - Hard upper ceiling of log events to retain in memory
   */
  constructor(maxSize = 50000) {
    this.maxSize = maxSize;
    /** @type {Array<import('./types.js').LogEvent>} */
    this.buffer = new Array(maxSize);
    this.head = 0;
    this.tail = 0;
    this.size = 0;

    // Setup local append-only logging session state tracking file path
    this.sessionLogPath = path.join(process.cwd(), '.tracewatch-session.jsonl');

    // Clear out any old lingering historical runtime session logs on initialize boot
    if (fs.existsSync(this.sessionLogPath)) {
      try {
        fs.unlinkSync(this.sessionLogPath);
      } catch (e) {}
    }
  }
  /**
   * Inserts a structured LogEvent into the sequential ring buffer and appends to disk.
   * @param {Omit<import('./types.js').LogEvent, 'id'>} eventData
   * @returns {import('./types.js').LogEvent} The fully populated event model record
   */
  append(eventData) {
    // Generate an incredibly fast incremental fallback identifier string sequence
    const uniqueId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    /** @type {import('./types.js').LogEvent} */
    const fullEvent = {
      id: uniqueId,
      timestamp: eventData.timestamp ?? new Date().toISOString(),
      service: eventData.service,
      level: eventData.level || 'info',
      message: eventData.message,
      requestId: eventData.requestId || null,
    };

    // 1. Ring Buffer Insertion Logic
    this.buffer[this.head] = fullEvent;
    this.head = (this.head + 1) % this.maxSize;

    if (this.size < this.maxSize) {
      this.size++;
    } else {
      // Buffer full: advance the tail index pointer to overwrite oldest item
      this.tail = (this.tail + 1) % this.maxSize;
    }

    // 2. Append directly to high-utility JSON-Lines transactional ledger on disk
    try {
      fs.appendFileSync(
        this.sessionLogPath,
        JSON.stringify(fullEvent) + '\n',
        'utf-8',
      );
    } catch (e) {
      // Prevent disk I/O errors from interrupting microservice collector loops
    }

    return fullEvent;
  }

  /**
   * Retrieves all log events currently stored in memory sorted chronologically.
   * @returns {import('./types.js').LogEvent[]}
   */
  getAll() {
    const result = [];
    let current = this.tail;

    for (let i = 0; i < this.size; i++) {
      result.push(this.buffer[current]);
      current = (current + 1) % this.maxSize;
    }

    return result;
  }
}
