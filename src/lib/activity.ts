import type { Prisma, PrismaClient } from "@prisma/client";

/** Append-only audit trail writer. No update/delete API exists for ActivityLog. */
type Tx = Prisma.TransactionClient | PrismaClient;

export async function logActivity(
  db: Tx,
  input: {
    businessId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.activityLog.create({
    data: {
      businessId: input.businessId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
