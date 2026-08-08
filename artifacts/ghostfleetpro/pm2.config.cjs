module.exports = {
  apps: [
    {
      name: "ghost-fleet-pro",
      script: "./node_modules/.bin/tsx",
      args: "server/index.ts",
      interpreter: "none",

      env_production: {
        NODE_ENV: "production",
        PORT: "5000",
        UV_THREADPOOL_SIZE: "64",
        NODE_OPTIONS: "--max-old-space-size=2048",
      },

      // Auto-restart if RAM exceeds 1.5 GB
      max_memory_restart: "1500M",

      // Restart policy
      restart_delay: 3000,
      max_restarts: 20,
      min_uptime: "10s",

      // Logs
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      error_file: "/var/log/ghostfleet/error.log",
      out_file: "/var/log/ghostfleet/out.log",
    },
  ],
};
