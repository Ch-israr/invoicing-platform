import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { getProductForUser, getProductFormData } from "@/server/services/product.service";
import { ProductForm } from "@/components/products/product-form";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteProductAction, updateProductAction } from "../../actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let product;
  let formData;
  try {
    ({ product } = await getProductForUser(session.user.id, id));
    formData = await getProductFormData(session.user.id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }
  if (!formData) redirect("/login");

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Edit Item</h1>
          <p className="text-sm text-muted-foreground">{product.name}</p>
        </div>
        <form action={deleteProductAction}>
          <input type="hidden" name="id" value={product.id} />
          <DeleteButton label="Delete" />
        </form>
      </div>
      <ProductForm
        product={{
          id: product.id,
          name: product.name,
          sku: product.sku,
          description: product.description,
          categoryId: product.categoryId,
          unit: product.unit,
          price: product.price.toString(),
          taxRateId: product.taxRateId,
          taxCategory: product.taxCategory,
          isActive: product.isActive,
        }}
        categories={formData.categories}
        taxRates={formData.taxRates.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          rate: t.rate.toString(),
        }))}
        currency={formData.business.currency}
        action={updateProductAction}
        submitLabel="Save changes"
      />
    </div>
  );
}
