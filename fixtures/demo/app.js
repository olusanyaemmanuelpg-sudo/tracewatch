// 1. Simulate an initial frontend user interaction
console.log('12:04:31.204  web  POST /api/orders');
console.log('12:04:31.219  api  validating payload');

// 2. Simulate a slight latency gap before the cascade breakdown happens
setTimeout(() => {
  // This line triggers our custom 'pool-exhausted' rule signature evaluation matching
  console.log('12:04:31.244  db   FATAL:  sorry, too many clients already');
  console.log(
    '12:04:31.251  api  ConnectionAcquireTimeout: timeout acquiring a connection',
  );
  console.log('12:04:31.258  web  Failed to fetch - 500');

  // Exit with an anomaly status code to show it's a failure
  process.exit(1);
}, 250);
