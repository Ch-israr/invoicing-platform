import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { formatMoney } from "@/lib/utils";
import { parsePage } from "@/lib/pagination";
import { listProducts } from "@/server/services/product.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/shared/pagination";
import { getDefaultBusinessForUser } from "@/lib/tenant";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const categoryId = typeof params.categoryId === "string" && params.categoryId ? params.categoryId : undefined;
  const status = params.status === "active" || params.status === "inactive" ? params.status : undefined;
  const page = parsePage(params.page);
  const deleteError = typeof params.deleteError === "string" ? params.deleteError : undefined;

  const business = await getDefaultBusinessForUser(session.user.id);
  const { products, total, pageCount, categories } = await listProducts(session.user.id, {
    q: q || undefined,
    categoryId,
    status,
    page,
  });

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (categoryId) sp.set("categoryId", categoryId);
    if (status) sp.set("status", status);
    sp.set("page", String(p));
    return `/products?${sp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Products &amp; Services</h1>
          <p className="text-sm text-muted-foreground">
            Catalogue items for invoices and quotations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/products/categories">Categories</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/products/import">Import CSV</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/products/export">Export CSV</a>
          </Button>
          <Button asChild>
            <Link href="/products/new">New Item</Link>
          </Button>
        </div>
      </div>

      {deleteError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </p>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search name, SKU or description"
          className="w-64"
          aria-label="Search products"
        />
        <Select name="categoryId" defaultValue={categoryId ?? ""} aria-label="Filter by category" className="w-44">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(q || categoryId || status) && (
          <Button variant="ghost" asChild>
            <Link href="/products">Clear</Link>
          </Button>
        )}
      </form>

      {products.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {total === 0 && !q && !categoryId && !status
                ? "No products or services yet. Add your first item, or import a CSV."
                : "No items match these filters."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">SKU</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.unit}
                        {p.taxRate ? ` · ${p.taxRate.code}` : ` · ${p.taxCategory.replace("_", " ")}`}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">{p.sku ?? "—"}</td>
                    <td className="hidden px-4 py-3 lg:table-cell">{p.category?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatMoney(Number(p.price), business?.currency ?? "AED")}
                    </td>
                    <td className="px-4 py-3">{p.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/products/${p.id}/edit`}>Edit</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} makeHref={makeHref} />
    </div>
  );
}
