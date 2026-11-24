import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProductFormData } from "@/server/services/product.service";
import { ProductForm } from "@/components/products/product-form";
import { createProductAction } from "../actions";

export default async function NewProductPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const data = await getProductFormData(session.user.id);
  if (!data) redirect("/login");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Product or Service</h1>
        <p className="text-sm text-muted-foreground">
          Add an item to your catalogue. It can be picked on invoices and
          quotations from Phase 3 onwards.
        </p>
      </div>
      <ProductForm
        categories={data.categories}
        taxRates={data.taxRates.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          rate: t.rate.toString(),
        }))}
        currency={data.business.currency}
        action={createProductAction}
        submitLabel="Create item"
      />
    </div>
  );
}
