-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENDING', 'SENT');

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_kind_ref_key" ON "email_deliveries"("kind", "ref");
