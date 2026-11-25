import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
} from "../actions";
import { CategoryForms } from "@/components/products/category-forms";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const deleteError = typeof params.deleteError === "string" ? params.deleteError : undefined;

  const business = await getDefaultBusinessForUser(session.user.id);
  if (!business) redirect("/login");
  const categories = await prisma.productCategory.findMany({
    where: { businessId: business.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Product Categories</h1>
        <p className="text-sm text-muted-foreground">
          Organise your catalogue. Deleting a category leaves its items
          uncategorised — items are never deleted with a category.
        </p>
      </div>

      {deleteError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add a category</CardTitle>
          <CardDescription>Category names are unique within your business.</CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryForms
            categories={categories.map((c) => ({ id: c.id, name: c.name, productCount: c._count.products }))}
            createAction={createCategoryAction}
            renameAction={renameCategoryAction}
            deleteAction={deleteCategoryAction}
          />
        </CardContent>
      </Card>

      <Button variant="outline" asChild>
        <Link href="/products">Back to products</Link>
      </Button>
    </div>
    </div>
  );
}
