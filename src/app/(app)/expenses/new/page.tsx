import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getExpenseFormData } from "@/server/services/expense.service";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { createExpenseAction } from "../actions";

export default async function NewExpensePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const data = await getExpenseFormData(session.user.id);
  if (!data) redirect("/login");
  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New expense</h1>
        <p className="text-sm text-muted-foreground">
          Record business spending. Attach the receipt when you have one.
        </p>
      </div>
      <ExpenseForm
        categories={data.categories}
        currency={data.business.currency}
        action={createExpenseAction}
        submitLabel="Save expense"
      />
    </div>
  );
}
