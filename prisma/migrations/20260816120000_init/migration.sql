-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('PERSON', 'ORG', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('NATIVE', 'PARTNER', 'WRAPPED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'ABANDONED');

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "kind" "AssetKind" NOT NULL DEFAULT 'NATIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- balance is BIGINT: minor units, never a float. This column type is the
-- single most important line in this migration.
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "eventId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- A zero entry moves nothing and carries no information; any transfer that
-- produces one is a bug that happens to balance. Enforced here rather than
-- only in the service, because the service is not the only thing that will
-- ever hold a connection to this database.
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_amount_nonzero" CHECK ("amount" <> 0);

-- An asset cannot have negative precision, and more than 18 decimal places
-- would exceed what BIGINT can represent for realistic balances.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_decimals_range" CHECK ("decimals" >= 0 AND "decimals" <= 18);

-- CreateIndex
CREATE UNIQUE INDEX "Party_kind_externalId_key" ON "Party"("kind", "externalId");

-- CreateIndex
CREATE INDEX "Party_externalId_idx" ON "Party"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_slug_key" ON "Asset"("slug");

-- CreateIndex
CREATE INDEX "Asset_kind_isActive_idx" ON "Asset"("kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Account_partyId_assetId_key" ON "Account"("partyId", "assetId");

-- CreateIndex
CREATE INDEX "Account_assetId_idx" ON "Account"("assetId");

-- The uniqueness that makes a retry safe. Exactly-once delivery is this
-- index, not a pre-flight check in application code.
CREATE UNIQUE INDEX "Transfer_idempotencyKey_key" ON "Transfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transfer_reason_createdAt_idx" ON "Transfer"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_eventId_idx" ON "Transfer"("eventId");

-- CreateIndex
CREATE INDEX "Entry_accountId_createdAt_idx" ON "Entry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Entry_assetId_idx" ON "Entry"("assetId");

-- CreateIndex
CREATE INDEX "Entry_transferId_idx" ON "Entry"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_transferId_venue_key" ON "Settlement"("transferId", "venue");

-- CreateIndex
CREATE INDEX "Settlement_venue_status_idx" ON "Settlement"("venue", "status");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
