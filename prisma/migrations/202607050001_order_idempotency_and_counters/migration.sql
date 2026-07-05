CREATE TABLE "app_counters" (
  "name" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "app_counters_pkey" PRIMARY KEY ("name")
);

INSERT INTO "app_counters" ("name", "value")
SELECT "name", COUNT(*)::INTEGER
FROM (VALUES ('order_number'), ('invoice_number')) AS counters("name")
CROSS JOIN "orders"
GROUP BY "name";

CREATE UNIQUE INDEX "orders_externalBotId_key" ON "orders"("externalBotId");
