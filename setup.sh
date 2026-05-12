#!/bin/bash
set -e

DOMAIN="dashboard.145.89.192.116.nip.io"

echo "=== SSH Dashboard Setup ==="

# Install dependencies
echo "[1/5] Installing Node.js dependencies..."
npm install

# Generate password hash if .env doesn't exist
if [ ! -f .env ]; then
  echo "[2/5] Creating .env file..."
  read -p "Enter dashboard username: " DASH_USER
  read -sp "Enter dashboard password: " DASH_PASS
  echo
  HASH=$(node -e "const bcrypt = require('bcrypt'); bcrypt.hash('$DASH_PASS', 10).then(h => console.log(h));")
  SECRET=$(openssl rand -hex 32)

  cat > .env <<EOF
USERNAME=$DASH_USER
PASSWORD_HASH=$HASH
SESSION_SECRET=$SECRET
PORT=3000
NODE_ENV=production
EOF
  echo ".env created."
else
  echo "[2/5] .env already exists, skipping."
fi

# Setup Nginx
echo "[3/5] Setting up Nginx..."
sudo cp nginx/dashboard.conf /etc/nginx/sites-available/dashboard
sudo ln -sf /etc/nginx/sites-available/dashboard /etc/nginx/sites-enabled/dashboard
sudo nginx -t
sudo systemctl reload nginx
echo "Nginx configured."

# SSL with Certbot
echo "[4/5] Setting up HTTPS with Certbot..."
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
echo "HTTPS configured."

# Systemd service (optional)
echo "[5/5] Creating systemd service..."
sudo tee /etc/systemd/system/dashboard.service > /dev/null <<EOF
[Unit]
Description=Terminal Dashboard
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
ExecStart=$(which node) server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable dashboard
sudo systemctl start dashboard

echo ""
echo "=== Setup complete ==="
echo "Dashboard available at: https://$DOMAIN"
