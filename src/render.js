import pc from 'picocolors';

/**
 * Formats a single LogEvent object into a beautifully color-coded terminal string.
 * @param {import('./types.js').LogEvent} event
 * @param {string} [serviceColor='white'] - Key matching available picocolors helpers
 * @returns {string} Fully styled terminal line
 */

export function formatLogEvent(event, serviceColor = 'white') {
  // Format a compact timestamp for high-volume terminal output.
  let timeString = '';
  try {
    const date = new Date(event.timestamp);
    timeString =
      date.toTimeString().split(' ')[0] +
      '.' +
      String(date.getMilliseconds()).padStart(3, '0');
  } catch (e) {
    timeString = '00:00:00.000';
  }

  // Select the configured service color for a stable visual identity.
  const colorizer = pc[serviceColor] || pc.white;

  const serviceBadge = colorizer(
    pc.bold(event.service.padEnd(10).slice(0, 10)),
  );
  const grayTimestamp = pc.gray(timeString);

  //Highlight lines that are flagged with high severity issues
  let messageText = event.message;
  if (event.level === 'fatal') {
    messageText = pc.bgRed(pc.white(pc.bold(` FATAL: ${event.message} `)));
  } else if (event.level === 'error') {
    messageText = pc.red(event.message);
  } else if (event.level === 'warn') {
    messageText = pc.yellow(event.message);
  }

  // Append context flags if an explicit correlation requestId tracking link is found
  const reqStr = event.requestId ? pc.gray(` [req:${event.requestId}]`) : '';

  const levelMarker =
    event.level === 'fatal'
      ? pc.red('!')
      : event.level === 'error'
        ? pc.red('x')
        : event.level === 'warn'
          ? pc.yellow('~')
          : pc.green('·');

  return `${levelMarker} ${grayTimestamp}  ${serviceBadge}  ${messageText}${reqStr}`;
}

/**
 * Instantly outputs a formatted log event directly to the active console terminal.
 * @param {import('./types.js').LogEvent} event
 * @param {string} [serviceColor]
 */
export function formatEvidenceLine(evidenceText, serviceColor = 'white') {
  const safeText = String(evidenceText ?? '').trim();
  if (!safeText) return pc.gray('No evidence available');

  const colorizer = pc[serviceColor] || pc.white;
  return colorizer(safeText);
}

export function renderToConsole(event, serviceColor) {
  console.log(formatLogEvent(event, serviceColor));
}
