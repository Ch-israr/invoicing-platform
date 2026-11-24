import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/shared/form-fields";

/** Date-range filter for report pages — plain GET form, no JS needed. */
export function DateRangeFilter({ from, to }: { from: string; to: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <Field label="From" htmlFor="report-from">
        <Input id="report-from" name="from" type="date" defaultValue={from} />
      </Field>
      <Field label="To" htmlFor="report-to">
        <Input id="report-to" name="to" type="date" defaultValue={to} />
      </Field>
      <Button type="submit" variant="outline">
        Apply
      </Button>
    </form>
  );
}
