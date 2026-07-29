# Despliegue Produccion - Asadero Mac Chicken

## Estructura En El VPS

```text
/opt/services/asadero_mac
├── .env
├── backend
└── bot
```

## Variables Del Compose

Crear `/opt/services/asadero_mac/.env`:

```env
POSTGRES_USER=asadero_mc_user
POSTGRES_PASSWORD=change-this-postgres-password
POSTGRES_DB=asadero_mc_admin
```

Los secretos reales van en:

```text
/opt/services/asadero_mac/backend/.env
/opt/services/asadero_mac/bot/.env
```

Dentro de Docker, usar nombres internos:

```env
# backend/.env
DATABASE_URL=postgresql://asadero_mc_user:TU_PASSWORD@postgres:5432/asadero_mc_admin
BOT_API_BASE_URL=http://bot:8000

# bot/.env
DATABASE_URL=postgresql+asyncpg://asadero_mc_user:TU_PASSWORD@postgres:5432/asadero_mc_admin
REDIS_URL=redis://redis:6379/0
CHROMA_HOST=chroma
CHROMA_PORT=8000
ADMIN_BACKEND_BASE_URL=http://backend:3000/api/v1/internal
```

## Instalacion Desde Cero

Desde `/opt/services/asadero_mac`:

```bash
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml up -d postgres redis chroma
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml build backend bot
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm backend npm run prisma:deploy
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm backend npm run db:seed
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm bot python -m scripts.migrate
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm bot python -m scripts.seed
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml up -d
```

## Actualizar Codigo

Desde `/opt/services/asadero_mac`:

```bash
git -C backend pull
git -C bot pull
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml up -d --build
```

Si el cambio incluye migraciones:

```bash
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm backend npm run prisma:deploy
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm bot python -m scripts.migrate
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml up -d --build
```

Si el cambio modifica seeds/catalogo:

```bash
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm backend npm run db:seed
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml run --rm bot python -m scripts.seed
```

## Verificacion

```bash
docker compose --env-file .env -f backend/deploy/docker-compose.prod.yml ps
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/health/dependencies
```

## Pendiente Fuera De Docker

- Nginx debe apuntar `api.asaderomacchicken.com` a `127.0.0.1:3000`.
- Nginx debe apuntar `bot.asaderomacchicken.com` a `127.0.0.1:8000`.
- Certbot debe emitir SSL para ambos subdominios.
- Vercel debe usar `VITE_API_BASE_URL=https://api.asaderomacchicken.com/api`.
- Vercel debe usar `VITE_WS_BASE_URL=wss://api.asaderomacchicken.com/ws`.
- Meta debe usar el webhook `https://bot.asaderomacchicken.com/webhooks/whatsapp`.
