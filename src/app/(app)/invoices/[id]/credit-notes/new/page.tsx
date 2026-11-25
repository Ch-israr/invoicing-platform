import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { TenantError } from "@/lib/tenant";
import { getCreditNoteFormData } from "@/server/services/credit-note.service";
import { CreditNoteForm } from "@/components/credit-notes/credit-note-form";

export default async function NewCreditNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  let data;
  try {
    data = await getCreditNoteFormData(session.user.id, id);
  } catch (err) {
    if (err instanceof TenantError) notFound();
    throw err;
  }

  const { business, invoice, lines } = data;
  if (
    invoice.status !== "ISSUED" &&
    invoice.status !== "SENT" &&
    invoice.status !== "PARTIALLY_PAID"
  ) {
    redirect(`/invoices/${id}`);
  }

  return (
    <div className="-m-4 min-h-[calc(100dvh-4rem)] space-y-6 bg-muted/60 p-4 md:-m-6 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New credit note</h1>
        <p className="text-sm text-muted-foreground">
          Credit part of invoice {invoice.number} back to{" "}
          {invoice.customer.companyName ?? invoice.customer.name}. The
          invoice itself stays unchanged.
        </p>
      </div>
      <CreditNoteForm
        invoiceId={invoice.id}
        invoiceNumber={invoice.number}
        currency={business.currency}
        balance={invoice.balance.toString()}
        lines={lines}
      />
      </div>
    </div>
  );
}
