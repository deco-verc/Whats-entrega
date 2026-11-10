// PM2 Ecosystem Configuration para VPS (Ubuntu 22.04/24.04 LTS)
// WhatsappEntrega - Gerenciamento de Processo Node.js em Producao

module.exports = {
  apps: [
    {
      name: "whatsapp-entrega",
      script: "dist/src/index.js",
      instances: 1, // Instancia unica estrita para garantir single-connection Baileys e SQLite WAL
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M", // Mantem footprint leve dentro da VM com RAM limitada
      kill_timeout: 10000, // Tempo para encerramento gracioso (10 segundos)
      restart_delay: 4000, // Pausa de respiro entre reconexoes automaticas
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "data/logs/pm2-error.log",
      out_file: "data/logs/pm2-out.log",
      merge_logs: true,
    },
  ],
};
