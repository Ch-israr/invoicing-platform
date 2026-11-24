import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CsvImportForm } from "@/components/products/csv-import-form";
import { importProductsAction } from "../actions";

const TEMPLATE = `Name,SKU,Description,Category,Unit,Price,Tax Category,Tax Rate Code,Active
Consulting — per hour,CONS-HR,Professional consulting,Services,hour,350,STANDARD,STD_5,yes
Annual support plan,SUP-ANN,12 months email support,Services,year,1200,STANDARD,STD_5,yes`;

export default async function ImportProductsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import Products from CSV</h1>
        <p className="text-sm text-muted-foreground">
          Bulk-add catalogue items. Rows with errors are reported — nothing
          is silently skipped.
        </p>
      </div>
      <CsvImportForm action={importProductsAction} />
      <Card>
        <CardHeader>
          <CardTitle>Template</CardTitle>
          <CardDescription>
            Copy this into a spreadsheet or a .csv file. Tax Category is one
            of STANDARD, ZERO_RATED, EXEMPT, OUT_OF_SCOPE. Tax Rate Code must
            match one of your VAT rates (STD_5, ZERO, EXEMPT).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{TEMPLATE}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
