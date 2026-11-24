import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import {
  canManageBusiness,
  canWrite,
  getDefaultBusinessForUser,
  requireCanWrite,
  requireMembership,
  scopeWhere,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { PAGE_SIZE, pageCount as calcPageCount } from "@/lib/pagination";
import {
  expenseCategorySchema,
  expenseSchema,
  type ExpenseInput,
} from "@/lib/validation/expense";
import type { ServiceResult } from "./invoice.service";

/**
 * Expenses — simple business spending with categories and receipts.
 *
 * Categories are per business and seeded with sensible defaults on
 * first use (not globally): Office, Travel, Software, Utilities,
 * Marketing, Other. Deleting a category unlinks its expenses (the
 * schema's onDelete: SetNull) — expenses themselves are never
 * deleted with it.
 */

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Office",
  "Travel",
  "Software",
  "Utilities",
  "Marketing",
  "Other",
] as const;

/** Create the default categories if the business has none yet. Idempotent. */
export async function ensureDefaultExpenseCategories(businessId: string): Promise<void> {
  const existing = await prisma.expenseCategory.count({ where: { businessId } });
  if (existing > 0) return;
  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ businessId, name })),
    skipDuplicates: true,
  });
}

export async function listExpenseCategories(userId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return [];
  await ensureDefaultExpenseCategories(business.id);
  return prisma.expenseCategory.findMany({
    where: scopeWhere(business.id),
    orderBy: { name: "asc" },
    include: { _count: { select: { expenses: true } } },
  });
}

export async function createExpenseCategory(
  userId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = expenseCategorySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  try {
    const category = await prisma.expenseCategory.create({
      data: { businessId: business.id, name: parsed.data.name },
    });
    await logActivity(prisma, {
      businessId: business.id,
      userId,
      action: "expense_category.created",
      entityType: "ExpenseCategory",
      entityId: category.id,
      metadata: { name: category.name },
    });
    return { ok: true, data: { id: category.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "A category with that name already exists" };
    }
    throw err;
  }
}

export async function deleteExpenseCategory(
  userId: string,
  categoryId: string,
): Promise<ServiceResult> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can delete categories");
  }
  const category = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, ...scopeWhere(business.id) },
  });
  if (!category) throw new TenantError(404, "Category not found");
  // Expenses survive with a null category (onDelete: SetNull).
  await prisma.expenseCategory.delete({ where: { id: category.id } });
  await logActivity(prisma, {
    businessId: business.id,
    userId,
    action: "expense_category.deleted",
    entityType: "ExpenseCategory",
    entityId: category.id,
    metadata: { name: category.name },
  });
  return { ok: true };
}

async function assertCategoryBelongs(
  businessId: string,
  categoryId: string | undefined,
): Promise<string | null> {
  if (!categoryId) return null;
  const category = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, businessId },
    select: { id: true },
  });
  if (!category) return "Selected category does not belong to this business";
  return null;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * Parse a `YYYY-MM-DD` date coming from a URL query param. Returns null
 * for anything malformed — an invalid date must never reach Prisma,
 * where an Invalid Date throws and 500s the page (this was the case for
 * /expenses?from=garbage before Phase 8).
 */
function parseFilterDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createExpense(
  userId: string,
  rawInput: unknown,
  receiptUrl?: string | null,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = expenseSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const input: ExpenseInput = parsed.data;
  const categoryError = await assertCategoryBelongs(business.id, input.categoryId);
  if (categoryError) return { ok: false, error: categoryError };
  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        businessId: business.id,
        categoryId: input.categoryId ?? null,
        vendor: input.vendor ?? null,
        title: input.title,
        date: toDate(input.date),
        amount: new Prisma.Decimal(input.amount),
        vatAmount: new Prisma.Decimal(input.vatAmount),
        method: input.method,
        description: input.description ?? null,
        receiptUrl: receiptUrl ?? null,
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "expense.created",
      entityType: "Expense",
      entityId: created.id,
      metadata: { title: created.title, amount: created.amount.toString() },
    });
    return created;
  });
  return { ok: true, data: { id: expense.id } };
}

export async function updateExpense(
  userId: string,
  expenseId: string,
  rawInput: unknown,
  receiptUrl?: string | null,
): Promise<ServiceResult> {
  const parsed = expenseSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ...scopeWhere(business.id) },
  });
  if (!expense) throw new TenantError(404, "Expense not found");
  const input: ExpenseInput = parsed.data;
  const categoryError = await assertCategoryBelongs(business.id, input.categoryId);
  if (categoryError) return { ok: false, error: categoryError };
  await prisma.expense.update({
    where: { id: expense.id },
    data: {
      categoryId: input.categoryId ?? null,
      vendor: input.vendor ?? null,
      title: input.title,
      date: toDate(input.date),
      amount: new Prisma.Decimal(input.amount),
      vatAmount: new Prisma.Decimal(input.vatAmount),
      method: input.method,
      description: input.description ?? null,
      // A new receipt replaces the old URL; passing undefined keeps it.
      ...(receiptUrl !== undefined ? { receiptUrl } : {}),
    },
  });
  await logActivity(prisma, {
    businessId: business.id,
    userId,
    action: "expense.updated",
    entityType: "Expense",
    entityId: expense.id,
    metadata: { title: input.title, amount: input.amount },
  });
  return { ok: true };
}

export async function deleteExpense(userId: string, expenseId: string): Promise<ServiceResult> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  const membership = await requireMembership(userId, business.id);
  if (!canManageBusiness(membership.role)) {
    throw new TenantError(403, "Only owners and admins can delete expenses");
  }
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ...scopeWhere(business.id) },
  });
  if (!expense) throw new TenantError(404, "Expense not found");
  await prisma.expense.delete({ where: { id: expense.id } });
  await logActivity(prisma, {
    businessId: business.id,
    userId,
    action: "expense.deleted",
    entityType: "Expense",
    entityId: expense.id,
    metadata: { title: expense.title, amount: expense.amount.toString() },
  });
  return { ok: true };
}

export async function getExpenseDetail(userId: string, expenseId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ...scopeWhere(business.id) },
    include: { category: true },
  });
  if (!expense) throw new TenantError(404, "Expense not found");
  const membership = await requireMembership(userId, business.id);
  return {
    business,
    expense,
    canManage: canManageBusiness(membership.role),
    canWrite: canWrite(membership.role),
  };
}

export type ExpenseFilters = {
  from?: string;
  to?: string;
  categoryId?: string;
  q?: string;
  page?: number;
};

export async function listExpenses(userId: string, filters: ExpenseFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) {
    return {
      expenses: [],
      total: 0,
      page: 1,
      pageCount: 1,
      currency: "AED",
      totals: { amount: new Decimal(0), vatAmount: new Decimal(0) },
    };
  }
  await ensureDefaultExpenseCategories(business.id);
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.ExpenseWhereInput = { businessId: business.id };
  if (filters.categoryId) where.categoryId = filters.categoryId;
  const fromDate = parseFilterDate(filters.from);
  const toDateValue = parseFilterDate(filters.to);
  if (fromDate || toDateValue) {
    where.date = {};
    if (fromDate) where.date.gte = fromDate;
    if (toDateValue) {
      const end = new Date(toDateValue);
      end.setUTCDate(end.getUTCDate() + 1);
      where.date.lt = end;
    }
  }
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { vendor: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  const [expenses, total, sums] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: { select: { id: true, name: true } } },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({
      where,
      _sum: { amount: true, vatAmount: true },
    }),
  ]);
  return {
    expenses,
    total,
    page,
    pageCount: calcPageCount(total),
    currency: business.currency,
    totals: {
      amount: new Decimal(sums._sum.amount ?? 0),
      vatAmount: new Decimal(sums._sum.vatAmount ?? 0),
    },
  };
}

/** Form data for the expense create/edit pages (categories seeded on first use). */
export async function getExpenseFormData(userId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return null;
  const categories = await listExpenseCategories(userId);
  return { business, categories };
}
