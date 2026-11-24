import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getDefaultBusinessForUser,
  requireCanWrite,
  requireMembership,
  scopeWhere,
  TenantError,
} from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { CsvParseError, headerIndex, parseCsv, toCsv } from "@/lib/csv";
import { PAGE_SIZE } from "@/lib/pagination";
import {
  productCategorySchema,
  productSchema,
  type ProductInput,
} from "@/lib/validation/product";

export type ServiceResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

/** Resolve a product id through the user's business — 404, never a leak. */
export async function getProductForUser(userId: string, productId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  const product = await prisma.product.findFirst({
    where: { id: productId, ...scopeWhere(business.id) },
    include: { category: true, taxRate: true },
  });
  if (!product) throw new TenantError(404, "Product not found");
  return { business, product };
}

export async function getProductFormData(userId: string) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return null;
  const [categories, taxRates] = await Promise.all([
    prisma.productCategory.findMany({
      where: scopeWhere(business.id),
      orderBy: { name: "asc" },
    }),
    prisma.taxRate.findMany({
      where: scopeWhere(business.id),
      orderBy: { code: "asc" },
    }),
  ]);
  return { business, categories, taxRates };
}

export type ProductFilters = {
  q?: string;
  categoryId?: string;
  status?: "active" | "inactive";
  page?: number;
};

export async function listProducts(userId: string, filters: ProductFilters) {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) {
    return { products: [], total: 0, page: 1, pageCount: 1, categories: [] };
  }
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.ProductWhereInput = { businessId: business.id };
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.status === "active") where.isActive = true;
  if (filters.status === "inactive") where.isActive = false;
  if (filters.q) {
    const q = filters.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  const [products, total, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: true, taxRate: true },
    }),
    prisma.product.count({ where }),
    prisma.productCategory.findMany({
      where: scopeWhere(business.id),
      orderBy: { name: "asc" },
    }),
  ]);
  return { products, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), categories };
}

async function assertSkuFree(
  businessId: string,
  sku: string | undefined,
  excludeId?: string,
): Promise<string | null> {
  if (!sku) return null;
  const existing = await prisma.product.findFirst({
    where: { businessId, sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return existing ? `SKU "${sku}" is already used by another item` : null;
}

async function assertRefsBelongToBusiness(
  businessId: string,
  input: ProductInput,
): Promise<string | null> {
  if (input.categoryId) {
    const cat = await prisma.productCategory.findFirst({
      where: { id: input.categoryId, businessId },
    });
    if (!cat) return "Selected category does not belong to this business";
  }
  if (input.taxRateId) {
    const rate = await prisma.taxRate.findFirst({
      where: { id: input.taxRateId, businessId },
    });
    if (!rate) return "Selected tax rate does not belong to this business";
  }
  return null;
}

export async function createProduct(
  userId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = productSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const input: ProductInput = parsed.data;
  const skuError = await assertSkuFree(business.id, input.sku);
  if (skuError) return { ok: false, error: skuError };
  const refError = await assertRefsBelongToBusiness(business.id, input);
  if (refError) return { ok: false, error: refError };

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        ...scopeWhere(business.id),
        name: input.name,
        sku: input.sku ?? null,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        unit: input.unit,
        price: new Prisma.Decimal(input.price),
        taxRateId: input.taxRateId ?? null,
        taxCategory: input.taxCategory,
        isActive: input.isActive,
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "product.created",
      entityType: "Product",
      entityId: created.id,
      metadata: { name: created.name, price: input.price },
    });
    return created;
  });
  return { ok: true, data: { id: product.id } };
}

export async function updateProduct(
  userId: string,
  productId: string,
  rawInput: unknown,
): Promise<ServiceResult> {
  const parsed = productSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { business, product } = await getProductForUser(userId, productId);
  await requireCanWrite(userId, business.id);
  const input: ProductInput = parsed.data;
  const skuError = await assertSkuFree(business.id, input.sku, product.id);
  if (skuError) return { ok: false, error: skuError };
  const refError = await assertRefsBelongToBusiness(business.id, input);
  if (refError) return { ok: false, error: refError };

  // Price edits only change the catalogue price. Historical invoices
  // snapshot price/description at issue time (Phase 3), so past
  // documents are never rewritten by a price change here.
  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: {
        name: input.name,
        sku: input.sku ?? null,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        unit: input.unit,
        price: new Prisma.Decimal(input.price),
        taxRateId: input.taxRateId ?? null,
        taxCategory: input.taxCategory,
        isActive: input.isActive,
      },
    });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "product.updated",
      entityType: "Product",
      entityId: product.id,
      metadata: { name: input.name, price: input.price },
    });
  });
  return { ok: true };
}

export async function deleteProduct(
  userId: string,
  productId: string,
): Promise<ServiceResult> {
  const { business, product } = await getProductForUser(userId, productId);
  await requireCanWrite(userId, business.id);
  const [invoiceRefs, quotationRefs] = await Promise.all([
    prisma.invoiceItem.count({ where: { productId: product.id } }),
    prisma.quotationItem.count({ where: { productId: product.id } }),
  ]);
  if (invoiceRefs + quotationRefs > 0) {
    return {
      ok: false,
      error:
        "This item is used on invoices or quotations and cannot be deleted. Set it to Inactive instead.",
    };
  }
  await prisma.$transaction(async (tx) => {
    await tx.product.delete({ where: { id: product.id } });
    await logActivity(tx, {
      businessId: business.id,
      userId,
      action: "product.deleted",
      entityType: "Product",
      entityId: product.id,
      metadata: { name: product.name },
    });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(
  userId: string,
  rawInput: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = productCategorySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  try {
    const category = await prisma.productCategory.create({
      data: { ...scopeWhere(business.id), name: parsed.data.name },
    });
    await logActivity(prisma, {
      businessId: business.id,
      userId,
      action: "product_category.created",
      entityType: "ProductCategory",
      entityId: category.id,
      metadata: { name: category.name },
    });
    return { ok: true, data: { id: category.id } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: `Category "${parsed.data.name}" already exists` };
    }
    throw err;
  }
}

export async function renameCategory(
  userId: string,
  categoryId: string,
  rawInput: unknown,
): Promise<ServiceResult> {
  const parsed = productCategorySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, ...scopeWhere(business.id) },
  });
  if (!category) throw new TenantError(404, "Category not found");
  try {
    await prisma.productCategory.update({
      where: { id: category.id },
      data: { name: parsed.data.name },
    });
    await logActivity(prisma, {
      businessId: business.id,
      userId,
      action: "product_category.updated",
      entityType: "ProductCategory",
      entityId: category.id,
      metadata: { name: parsed.data.name },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: `Category "${parsed.data.name}" already exists` };
    }
    throw err;
  }
}

export async function deleteCategory(
  userId: string,
  categoryId: string,
): Promise<ServiceResult> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);
  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, ...scopeWhere(business.id) },
  });
  if (!category) throw new TenantError(404, "Category not found");
  // Products in the category become uncategorised (FK is SetNull).
  await prisma.productCategory.delete({ where: { id: category.id } });
  await logActivity(prisma, {
    businessId: business.id,
    userId,
    action: "product_category.deleted",
    entityType: "ProductCategory",
    entityId: category.id,
    metadata: { name: category.name },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------

export async function exportProductsCsv(userId: string): Promise<string> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) throw new TenantError(404, "Business not found");
  await requireMembership(userId, business.id);
  const products = await prisma.product.findMany({
    where: scopeWhere(business.id),
    orderBy: { name: "asc" },
    include: { category: true, taxRate: true },
  });
  return toCsv(
    ["Name", "SKU", "Description", "Category", "Unit", "Price", "Tax Category", "Tax Rate Code", "Active"],
    products.map((p) => [
      p.name, p.sku, p.description, p.category?.name ?? "", p.unit,
      p.price.toString(), p.taxCategory, p.taxRate?.code ?? "",
      p.isActive ? "yes" : "no",
    ]),
  );
}

export type CsvImportResult = {
  created: number;
  errors: { row: number; message: string }[];
};

/**
 * Imports products from CSV text. Every row is either created or
 * reported in `errors` — bad rows are never silently skipped.
 * Columns: Name*, Price*, SKU, Description, Category, Unit,
 * Tax Category, Tax Rate Code, Active. Unknown categories are created.
 */
export async function importProductsCsv(
  userId: string,
  csvText: string,
): Promise<ServiceResult<CsvImportResult>> {
  const business = await getDefaultBusinessForUser(userId);
  if (!business) return { ok: false, error: "No business found" };
  await requireCanWrite(userId, business.id);

  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (err) {
    if (err instanceof CsvParseError) return { ok: false, error: err.message };
    throw err;
  }
  if (rows.length === 0) return { ok: false, error: "The file is empty" };
  const headers = headerIndex(rows[0]);
  if (!headers.has("name") || !headers.has("price")) {
    return { ok: false, error: 'CSV must have "Name" and "Price" columns' };
  }

  const taxRates = await prisma.taxRate.findMany({
    where: scopeWhere(business.id),
  });
  const rateByCode = new Map(taxRates.map((r) => [r.code.toUpperCase(), r]));
  const categoryCache = new Map<string, string>();
  for (const c of await prisma.productCategory.findMany({ where: scopeWhere(business.id) })) {
    categoryCache.set(c.name.toLowerCase(), c.id);
  }

  const errors: { row: number; message: string }[] = [];
  const valid: { input: ProductInput; rowNo: number }[] = [];
  const seenSkus = new Set<string>();

  const cell = (row: string[], name: string): string => {
    const idx = headers.get(name);
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 1; // header is row 1
    const name = cell(row, "name");
    const price = cell(row, "price");
    const sku = cell(row, "sku");
    const taxCategoryRaw = cell(row, "tax category") || "STANDARD";
    const taxRateCode = cell(row, "tax rate code");
    const activeRaw = cell(row, "active").toLowerCase();

    let taxRateId: string | undefined;
    if (taxRateCode) {
      const rate = rateByCode.get(taxRateCode.toUpperCase());
      if (!rate) {
        errors.push({ row: rowNo, message: `Unknown tax rate code "${taxRateCode}"` });
        continue;
      }
      taxRateId = rate.id;
    }

    let categoryId: string | undefined;
    const categoryName = cell(row, "category");
    if (categoryName) {
      const cached = categoryCache.get(categoryName.toLowerCase());
      if (cached) {
        categoryId = cached;
      } else {
        // Resolve after validation, in the transaction, so a failed
        // import does not create stray categories.
        categoryId = `__new__:${categoryName}`;
      }
    }

    const parsed = productSchema.safeParse({
      name,
      sku: sku || undefined,
      description: cell(row, "description") || undefined,
      categoryId,
      unit: cell(row, "unit") || "pcs",
      price,
      taxRateId,
      taxCategory: taxCategoryRaw.toUpperCase(),
      isActive: activeRaw === "" || activeRaw === "yes" || activeRaw === "true" || activeRaw === "1",
    });
    if (!parsed.success) {
      errors.push({ row: rowNo, message: parsed.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    if (parsed.data.sku) {
      const key = parsed.data.sku.toLowerCase();
      if (seenSkus.has(key)) {
        errors.push({ row: rowNo, message: `Duplicate SKU "${parsed.data.sku}" in this file` });
        continue;
      }
      seenSkus.add(key);
    }
    valid.push({ input: parsed.data, rowNo });
  }

  // Duplicate SKUs against existing catalogue products.
  const existingSkus = new Set(
    (
      await prisma.product.findMany({
        where: {
          businessId: business.id,
          sku: { in: valid.filter((v) => v.input.sku).map((v) => v.input.sku as string) },
        },
        select: { sku: true },
      })
    ).map((p) => (p.sku ?? "").toLowerCase()),
  );
  const toCreate: ProductInput[] = [];
  for (const { input: v, rowNo } of valid) {
    if (v.sku && existingSkus.has(v.sku.toLowerCase())) {
      errors.push({ row: rowNo, message: `SKU "${v.sku}" already exists in your catalogue` });
    } else {
      toCreate.push(v);
    }
  }

  let created = 0;
  if (toCreate.length > 0) {
    created = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const v of toCreate) {
        let categoryId = v.categoryId;
        if (categoryId?.startsWith("__new__:")) {
          const categoryName = categoryId.slice("__new__:".length);
          const existing = await tx.productCategory.findFirst({
            where: { businessId: business.id, name: { equals: categoryName, mode: "insensitive" } },
          });
          if (existing) {
            categoryId = existing.id;
          } else {
            const createdCat = await tx.productCategory.create({
              data: { businessId: business.id, name: categoryName },
            });
            categoryId = createdCat.id;
          }
        }
        await tx.product.create({
          data: {
            businessId: business.id,
            name: v.name,
            sku: v.sku ?? null,
            description: v.description ?? null,
            categoryId: categoryId ?? null,
            unit: v.unit,
            price: new Prisma.Decimal(v.price),
            taxRateId: v.taxRateId ?? null,
            taxCategory: v.taxCategory,
            isActive: v.isActive,
          },
        });
        count++;
      }
      await logActivity(tx, {
        businessId: business.id,
        userId,
        action: "product.imported",
        entityType: "Product",
        metadata: { created: count, errors: errors.length },
      });
      return count;
    });
  }

  errors.sort((a, b) => a.row - b.row);
  return { ok: true, data: { created, errors } };
}
