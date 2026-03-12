import { execa } from 'execa';
import { ALLOWED_SERVICES } from '../../lib/services.js';

// Track active journalctl processes for cleanup on server shutdown
const activeProcesses = new Set();

// Backpressure: max bytes buffered before we pause the child stdout stream
const MAX_SEND_BUFFER_BYTES = 64 * 1024; // 64 KB

export default async function logsRoutes(fastify, _opts) {
  fastify.get(
    '/services/:name/logs',
    { websocket: true, preHandler: fastify.requireRole(['admin']) },
    (socket, request) => {
      const { name } = request.params;

      // Validate service name
      if (!ALLOWED_SERVICES.includes(name)) {
        socket.close(1008, 'Unknown service');
        return;
      }

      let child = null;
      let lineBuffer = '';
      let sendBuffer = [];
      let sendBufferBytes = 0;
      let stdoutPaused = false;

      try {
        child = execa(
          'journalctl',
          ['-u', name, '-f', '-n', '100', '--output=short-iso'],
          {
            reject: false,
            buffer: false,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
      } catch (err) {
        request.log.error({ err }, 'Failed to spawn journalctl');
        socket.send(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            message: `[Error: Failed to start log stream for ${name}]`,
          }),
        );
        socket.close(1011, 'Failed to spawn journalctl');
        return;
      }

      activeProcesses.add(child);

      /**
       * Attempt to flush buffered messages to the WebSocket.
       * Drops oldest messages if buffer exceeds the size limit.
       * Pauses/resumes child stdout based on buffer pressure.
       */
      function flushSendBuffer() {
        while (sendBuffer.length > 0) {
          if (socket.readyState !== 1 /* OPEN */) {
            // Socket not open — discard everything
            sendBuffer.length = 0;
            sendBufferBytes = 0;
            return;
          }

          const msg = sendBuffer[0];
          try {
            socket.send(msg);
            sendBufferBytes -= msg.length;
            sendBuffer.shift();
          } catch {
            // Socket may have closed mid-send
            sendBuffer.length = 0;
            sendBufferBytes = 0;
            return;
          }
        }

        // Buffer drained — resume child stdout if it was paused
        if (stdoutPaused && child?.stdout) {
          stdoutPaused = false;
          child.stdout.resume();
        }
      }

      /**
       * Enqueue a serialized message for sending.
       * Enforces the buffer size limit by dropping oldest messages.
       */
      function enqueueMessage(serialized) {
        sendBuffer.push(serialized);
        sendBufferBytes += serialized.length;

        // Drop oldest messages while buffer exceeds the limit
        while (sendBufferBytes > MAX_SEND_BUFFER_BYTES && sendBuffer.length > 1) {
          const dropped = sendBuffer.shift();
          sendBufferBytes -= dropped.length;
        }

        // Pause child stdout when buffer is full to apply backpressure
        if (sendBufferBytes > MAX_SEND_BUFFER_BYTES && !stdoutPaused && child?.stdout) {
          stdoutPaused = true;
          child.stdout.pause();
        }
      }

      // Handle WebSocket drain — buffer has been flushed by the network layer
      socket.on('drain', () => {
        flushSendBuffer();
      });

      // Parse and send lines from journalctl stdout
      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split('\n');
          // Keep the last incomplete line in the buffer
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            const parsed = parseLine(line);
            const serialized = JSON.stringify(parsed);

            if (socket.readyState === 1 /* OPEN */ && sendBuffer.length === 0) {
              // Fast path: send directly when buffer is empty and socket is open
              try {
                socket.send(serialized);
              } catch {
                // Socket closed — will be cleaned up by close event
              }
            } else {
              enqueueMessage(serialized);
            }
          }

          // Try to flush any queued messages
          if (sendBuffer.length > 0) {
            flushSendBuffer();
          }
        });
      }

      // Handle journalctl exit
      child.then(() => {
        activeProcesses.delete(child);
        try {
          if (socket.readyState === 1 /* OPEN */) {
            socket.send(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                message: '[Log stream ended]',
              }),
            );
            socket.close(1000, 'Log stream ended');
          }
        } catch {
          // Socket may already be closed
        }
      });

      // Clean up on WebSocket close
      socket.on('close', () => {
        sendBuffer.length = 0;
        sendBufferBytes = 0;
        if (child) {
          activeProcesses.delete(child);
          child.kill('SIGTERM');
        }
      });

      // Clean up on WebSocket error
      socket.on('error', (err) => {
        request.log.error({ err }, 'WebSocket error for log stream');
        sendBuffer.length = 0;
        sendBufferBytes = 0;
        if (child) {
          activeProcesses.delete(child);
          child.kill('SIGTERM');
        }
      });
    },
  );

  // Clean up all journalctl processes on server shutdown
  fastify.addHook('onClose', async () => {
    for (const proc of activeProcesses) {
      proc.kill('SIGTERM');
    }
    activeProcesses.clear();
  });
}

/**
 * Parse a journalctl --output=short-iso line into { timestamp, message }.
 * Format: 2024-03-15T10:30:45+0000 hostname servicename[pid]: log message
 */
function parseLine(line) {
  // ISO timestamp is at the beginning, match until first space after the ISO pattern
  const isoMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)\s+(.*)$/,
  );
  if (isoMatch) {
    return {
      timestamp: isoMatch[1],
      message: isoMatch[2],
    };
  }

  return {
    timestamp: '',
    message: line,
  };
}
