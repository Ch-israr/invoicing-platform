import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { getCustomerForUser } from "@/server/services/customer.service";
import { CustomerForm } from "@/components/customers/customer-form";
import { updateCustomerAction } from "../../actions";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let customer;
  try {
    ({ customer } = await getCustomerForUser(session.user.id, id));
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit Customer</h1>
        <p className="text-sm text-muted-foreground">{customer.name}</p>
      </div>
      <CustomerForm
        customer={{
          id: customer.id,
          type: customer.type,
          name: customer.name,
          companyName: customer.companyName,
          email: customer.email,
          phone: customer.phone,
          billingAddress: customer.billingAddress,
          shippingAddress: customer.shippingAddress,
          country: customer.country,
          trn: customer.trn,
          notes: customer.notes,
          status: customer.status,
        }}
        action={updateCustomerAction}
        submitLabel="Save changes"
      />
    </div>
  );
}
