import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listExpenseCategories } from "@/server/services/expense.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton } from "@/components/shared/delete-button";
import { CategoryForm } from "@/components/expenses/category-form";
import {
  createExpenseCategoryAction,
  deleteExpenseCategoryAction,
} from "../actions";

export default async function ExpenseCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const deleteError = typeof params.deleteError === "string" ? params.deleteError : undefined;

  const categories = await listExpenseCategories(session.user.id);

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Expense categories</h1>
        <p className="text-sm text-muted-foreground">
          Categories are per business. Deleting one unlinks its expenses —
          the expenses themselves stay.
        </p>
      </div>

      {deleteError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>New category</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryForm action={createExpenseCategoryAction} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {categories.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No categories yet.</p>
          ) : (
            <ul className="divide-y">
              {categories.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-6 py-4"
                >
                  <p className="font-medium">
                    {c.name}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {c._count.expenses} expense{c._count.expenses === 1 ? "" : "s"}
                    </span>
                  </p>
                  <form action={deleteExpenseCategoryAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <DeleteButton label="Delete" />
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
