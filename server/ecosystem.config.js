// pm2 process config for the Decentroneum push server.
//
// Deploy, from the directory this file sits in:
//
//   npm install              # full install — the build needs typescript

//   npm run build
//   pm2 start ecosystem.config.js
//   pm2 save                 # persist across reboots (run `pm2 startup` once, first time only)
//
// pm2's own restart policy (below) is a second, independent layer of
// resilience on top of the in-process reconnect/watchdog logic in
// chainWatcher.ts and the uncaughtException/unhandledRejection guards in
// index.ts — this is what brings the whole Node process back if it ever
// exits for a reason those handlers didn't catch.
module.exports = {
  apps: [
    {
      name: "decentroneum-push",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1, // single instance — see server/README.md on the SQLite/cursor
                    // constraint if you ever need to scale beyond one process
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 50,
      min_uptime: "10s", // a restart within 10s of the last one counts toward max_restarts,
                          // so a genuine crash-loop still gets flagged instead of retried forever
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      time: true,
    },
  ],
};
