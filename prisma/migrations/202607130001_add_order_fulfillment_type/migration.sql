-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('DELIVERY', 'PICKUP');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'DELIVERY';

-- CreateIndex
CREATE INDEX "orders_fulfillmentType_status_createdAt_idx" ON "orders"("fulfillmentType", "status", "createdAt");
