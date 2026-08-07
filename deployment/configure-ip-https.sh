#!/usr/bin/env bash
set -euo pipefail

PUBLIC_IP="${PUBLIC_IP:-101.37.87.144}"
UPSTREAM="${UPSTREAM:-127.0.0.1:3020}"
NGINX_CONFIG="${NGINX_CONFIG:-/etc/nginx/conf.d/enterprise-ai-landing-guide-ip.conf}"
CERTBOT_IMAGE="${CERTBOT_IMAGE:-certbot/certbot:latest}"
CERT_ROOT="/etc/letsencrypt/live/$PUBLIC_IP"
WEBROOT="/var/www/certbot"

if [ "$(id -u)" -ne 0 ]; then
  echo "This deployment script must run as root." >&2
  exit 1
fi
docker image inspect "$CERTBOT_IMAGE" >/dev/null
mkdir -p "$WEBROOT" /var/lib/letsencrypt /var/log/letsencrypt

cat > "$NGINX_CONFIG" <<EOF
limit_req_zone \$binary_remote_addr zone=enterprise_ai_landing_rate:10m rate=1r/s;

server {
    listen 80;
    listen [::]:80;
    server_name $PUBLIC_IP;

    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 200 'certificate validation ready';
        add_header Content-Type text/plain;
    }
}
EOF
nginx -t
systemctl reload nginx

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /var/log/letsencrypt:/var/log/letsencrypt \
  -v "$WEBROOT:$WEBROOT" \
  "$CERTBOT_IMAGE" certonly \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path "$WEBROOT" \
  --ip-address "$PUBLIC_IP"

test -s "$CERT_ROOT/fullchain.pem"
test -s "$CERT_ROOT/privkey.pem"

cat > "$NGINX_CONFIG" <<EOF
limit_req_zone \$binary_remote_addr zone=enterprise_ai_landing_rate:10m rate=1r/s;

server {
    listen 80;
    listen [::]:80;
    server_name $PUBLIC_IP;

    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $PUBLIC_IP;

    ssl_certificate $CERT_ROOT/fullchain.pem;
    ssl_certificate_key $CERT_ROOT/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 10m;
    proxy_connect_timeout 15s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    location = / {
        return 302 /enterprise-ai-landing-guide;
    }

    location ^~ /api/public/clawhive/v1/ {
        limit_req zone=enterprise_ai_landing_rate burst=60 nodelay;
        limit_req_status 429;
        proxy_pass http://$UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location = /enterprise-ai-landing-guide {
        proxy_pass http://$UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    }

    location ^~ /assets/ {
        proxy_pass http://$UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    }

    location ^~ /legal/clawhive/ {
        proxy_pass http://$UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    }

    location / {
        return 404;
    }
}
EOF
nginx -t
systemctl reload nginx

cat > /etc/systemd/system/certbot-ip-renew.service <<EOF
[Unit]
Description=Renew short-lived Let's Encrypt IP certificate
After=docker.service nginx.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /var/lib/letsencrypt:/var/lib/letsencrypt -v /var/log/letsencrypt:/var/log/letsencrypt -v $WEBROOT:$WEBROOT $CERTBOT_IMAGE renew --quiet
ExecStartPost=/usr/sbin/nginx -t
ExecStartPost=/usr/bin/systemctl reload nginx
EOF

cat > /etc/systemd/system/certbot-ip-renew.timer <<'EOF'
[Unit]
Description=Check the short-lived IP certificate twice daily

[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now certbot-ip-renew.timer
systemctl start certbot-ip-renew.service

curl -fsS "https://$PUBLIC_IP/api/public/clawhive/v1/health" >/dev/null
echo "HTTPS configured: https://$PUBLIC_IP/api/public/clawhive/v1"
systemctl list-timers certbot-ip-renew.timer --no-pager
