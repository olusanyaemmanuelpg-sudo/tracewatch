const frames = ['|', '/', '-', '\\'];
const MINIMUM_SPINNER_DURATION_MS = 500;

/**
 * Starts a terminal spinner and returns a function that stops it cleanly.
 * Spinners stay disabled when output is redirected or running in CI.
 * @param {string} label
 * @returns {{ stop: (message?: string) => void }}
 */
export function createSpinner(label) {
  if (!process.stdout.isTTY) {
    return {
      stop(message = '') {
        if (message) console.log(message);
      },
    };
  }

  let frameIndex = 0;
  let stopped = false;
  const startedAt = Date.now();
  const render = () => {
    process.stdout.write(`\r${frames[frameIndex]} ${label}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  render();
  const timer = setInterval(render, 100);

  return {
    stop(message = '') {
      if (stopped) return;

      const finish = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        process.stdout.write('\r\x1b[2K');
        if (message) process.stdout.write(`${message}\n`);
      };

      const remaining = MINIMUM_SPINNER_DURATION_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        setTimeout(finish, remaining);
      } else {
        finish();
      }
    },
  };
}
