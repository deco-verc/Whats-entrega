#!/usr/bin/env bash
# ==============================================================================
# Script de Provisionamento de VPS Google Cloud (Ubuntu 22.04/24.04 LTS)
# Projeto: WhatsappEntrega
# Alvo: GCP Compute Engine e2-micro (1 GB RAM, 2 vCPUs compartilhadas)
# ==============================================================================

set -euo pipefail

echo "[Setup] Iniciando provisionamento da VPS Ubuntu no Google Cloud..."

# 1. Atualizacao inicial de pacotes do sistema
echo "[Setup] Atualizando repositorios e pacotes do sistema..."
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  ca-certificates \
  gnupg \
  ufw \
  ffmpeg

# 2. Ativacao de 2 GB de Memoria Swap (Obrigatorio para e2-micro de 1 GB RAM)
echo "[Setup] Configurando 2 GB de arquivo Swap..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  sudo sysctl vm.swappiness=10
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
  echo "[Setup] Swap de 2 GB ativado com sucesso."
else
  echo "[Setup] Arquivo /swapfile ja existente. Pulando criacao."
fi

# 3. Instalacao do Node.js 22 LTS (NodeSource)
echo "[Setup] Instalando Node.js 22 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "[Setup] Node.js $(node -v) e npm $(npm -v) instalados."
else
  echo "[Setup] Node.js ja instalado: $(node -v)"
fi

# 4. Instalacao do PM2 (Gerenciador de Processos)
echo "[Setup] Instalando PM2 globalmente..."
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2
  echo "[Setup] PM2 instalado com sucesso."
else
  echo "[Setup] PM2 ja instalado: $(pm2 -v)"
fi

# 5. Instalacao do Caddy Server (Reverse Proxy com Auto-HTTPS)
echo "[Setup] Instalando Caddy Server..."
if ! command -v caddy &> /dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y
  sudo apt-get install -y caddy
  echo "[Setup] Caddy instalado com sucesso."
else
  echo "[Setup] Caddy ja instalado: $(caddy version)"
fi

# 6. Configuracao do Firewall UFW
echo "[Setup] Configurando regras de Firewall (UFW)..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP Caddy'
sudo ufw allow 443/tcp comment 'HTTPS Caddy'
echo "y" | sudo ufw enable || true
sudo ufw status verbose

# 7. Criacao da estrutura de diretorios locais de persistencia
echo "[Setup] Criando diretorios de dados e midia..."
mkdir -p data/auth_info
mkdir -p data/database
mkdir -p data/media
mkdir -p data/logs
chmod -R 750 data

# 8. Dependencias do Projeto e Compilacao TypeScript
echo "[Setup] Instalando dependencias do projeto e compilando TypeScript..."
npm ci
npm run build

# 9. Copia do Caddyfile para o diretorio do sistema
if [ -f Caddyfile ]; then
  echo "[Setup] Atualizando configuracao do Caddy Server..."
  sudo cp Caddyfile /etc/caddy/Caddyfile
  sudo systemctl reload caddy || sudo systemctl restart caddy
fi

# 10. Inicializacao do servico via PM2
echo "[Setup] Inicializando aplicacao com PM2..."
pm2 start ecosystem.config.js || pm2 reload ecosystem.config.js
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME" || true

echo "=============================================================================="
echo "[Setup] Provisionamento concluido com sucesso!"
echo "Acesse os logs com: pm2 logs whatsapp-entrega"
echo "Status do servico:  pm2 status"
echo "=============================================================================="
