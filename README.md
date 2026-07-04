# ASADERO MC Admin Backend

Backend Node.js + TypeScript para el panel administrativo, pedidos, catalogo, conversaciones, facturas internas y conexion con el bot.

## Stack

- Express
- TypeScript
- Prisma
- PostgreSQL
- BetterAuth
- WebSocket nativo con `ws`

## Variables

```bash
cp .env.example .env
```

Variables principales:

```env
PORT=3000
APP_BASE_URL=http://localhost:3000
FRONTEND_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://asadero_mc_user:asadero_local_2026@localhost:5432/asadero_mc_admin
INTERNAL_API_KEY=change-this-internal-api-key
BOT_API_BASE_URL=http://localhost:8000
ADMIN_EMAIL=admin@asadero.local
ADMIN_PASSWORD=change-this-password
ADMIN_NAME=Administrador
```

`INTERNAL_API_KEY` debe ser igual en el backend Node y en el bot Python.

## PostgreSQL Local

En Ubuntu, `sudo -u postgres psql` entra por autenticacion local del sistema, pero Prisma se conecta por TCP a `localhost:5432` y necesita usuario + password reales.

Desde `sudo -u postgres psql`, configura el usuario de aplicacion:

```sql
DO $$
BEGIN
  CREATE ROLE asadero_mc_user WITH LOGIN PASSWORD 'asadero_local_2026';
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE asadero_mc_user WITH PASSWORD 'asadero_local_2026';
END
$$;

ALTER ROLE asadero_mc_user CREATEDB;
ALTER DATABASE asadero_mc_admin OWNER TO asadero_mc_user;
\c asadero_mc_admin
ALTER SCHEMA public OWNER TO asadero_mc_user;
GRANT ALL ON SCHEMA public TO asadero_mc_user;
```

Luego deja `DATABASE_URL` en `.env` con ese usuario y ejecuta `npm run prisma:migrate`.

## Instalacion

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run db:seed
npm run dev
```

## Endpoints Principales

Panel:

```text
GET    /api/admin/orders/incoming
GET    /api/admin/orders/accepted
GET    /api/admin/orders/rejected
GET    /api/admin/orders/:id
PATCH  /api/admin/orders/:id/accept
PATCH  /api/admin/orders/:id/reject
PATCH  /api/admin/orders/:id/status
GET    /api/admin/catalog/products
POST   /api/admin/catalog/products
GET    /api/admin/conversations/orders/:orderId/messages
POST   /api/admin/conversations/orders/:orderId/messages
```

Bot interno:

```text
POST /api/v1/internal/orders
GET  /api/v1/internal/catalog
POST /api/v1/internal/messages/incoming
```

Realtime:

```text
ws://localhost:3000/ws
```

## Flujo

1. El bot confirma el pedido.
2. El bot llama `POST /api/v1/internal/orders`.
3. El backend crea cliente, pedido, factura interna e items.
4. El frontend se actualiza por WebSocket.
5. El admin gestiona estados e imprime 2 copias de la factura.
6. El admin puede responder al cliente desde el detalle del pedido.
