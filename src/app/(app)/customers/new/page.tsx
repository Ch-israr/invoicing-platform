import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CustomerForm } from "@/components/customers/customer-form";
import { createCustomerAction } from "../actions";

export default async function NewCustomerPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Customer</h1>
        <p className="text-sm text-muted-foreground">
          Add a person or company you will invoice.
        </p>
      </div>
      <CustomerForm action={createCustomerAction} submitLabel="Create customer" />
    </div>
  );
}
