import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import {
  getExpenseDetail,
  listExpenseCategories,
} from "@/server/services/expense.service";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteExpenseAction, updateExpenseAction } from "../actions";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let detail;
  try {
    detail = await getExpenseDetail(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }
  const categories = await listExpenseCategories(session.user.id);
  const { business, expense, canManage } = detail;

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{expense.title}</h1>
          <p className="text-sm text-muted-foreground">
            {formatMoney(expense.amount.toString(), business.currency)} ·{" "}
            {new Intl.DateTimeFormat("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }).format(expense.date)}
            {expense.category ? ` · ${expense.category.name}` : ""}
            {expense.vendor ? ` · ${expense.vendor}` : ""}
          </p>
        </div>
        {canManage ? (
          <form action={deleteExpenseAction}>
            <input type="hidden" name="id" value={expense.id} />
            <DeleteButton label="Delete expense" />
          </form>
        ) : null}
      </div>

      <ExpenseForm
        expenseId={expense.id}
        initial={{
          title: expense.title,
          date: expense.date.toISOString().slice(0, 10),
          amount: expense.amount.toString(),
          vatAmount: expense.vatAmount.toString(),
          categoryId: expense.categoryId ?? "",
          vendor: expense.vendor ?? "",
          method: expense.method,
          description: expense.description ?? "",
          receiptUrl: expense.receiptUrl,
        }}
        categories={categories}
        currency={business.currency}
        action={updateExpenseAction}
        submitLabel="Save changes"
      />
    </div>
  );
}
