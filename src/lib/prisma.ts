import { PrismaClient } from '@prisma/client';

// Single client, reused across hot reloads in development so a dev server
// doesn't exhaust the connection pool by minting a client per reload.
const globalForPrisma = globalThis as unknown as { ledgerPrisma?: PrismaClient };

export const prisma = globalForPrisma.ledgerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.ledgerPrisma = prisma;
