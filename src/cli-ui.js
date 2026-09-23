const frames = ['|', '/', '-', '\\'];

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
  const render = () => {
    process.stdout.write(`\r${frames[frameIndex]} ${label}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  render();
  const timer = setInterval(render, 100);

  return {
    stop(message = '') {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write('\r\x1b[2K');
      if (message) process.stdout.write(`${message}\n`);
    },
  };
}
