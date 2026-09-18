import pc from 'picocolors';

/**
 * Formats a single LogEvent object into a beautifully color-coded terminal string.
 * @param {import('./types.js').LogEvent} event
 * @param {string} [serviceColor='white'] - Key matching available picocolors helpers
 * @returns {string} Fully styled terminal line
 */

export function formatLogEvent(event, serviceColor = 'white') {
  // Format human-readable time format string
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

  // Select appropriate text colorizer depending on configured profile settings
  const colorizer = pc[serviceColor] || pc.white;

  // Format service identifier badge string with unified padding layout
  const serviceBadge = colorizer(event.service.padEnd(8).slice(0, 8));
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
  const reqStr = event.requestId
    ? pc.darkGray(` [req:${event.requestId}]`)
    : '';

  return `${grayTime}  ${serviceBadge}  ${messageText}${reqStr}`;
}

/**
 * Instantly outputs a formatted log event directly to the active console terminal.
 * @param {import('./types.js').LogEvent} event
 * @param {string} [serviceColor]
 */
export function renderToConsole(event, serviceColor) {
  console.log(formatLogLine(event, serviceColor));
}
