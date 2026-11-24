import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Server component: previous / next links preserving the list filters. */
export function Pagination({
  page,
  pageCount,
  total,
  makeHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  makeHref: (page: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 pt-2">
      <p className="text-sm text-muted-foreground">
        {total} result{total === 1 ? "" : "s"} · Page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={makeHref(page - 1)}>Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        {page < pageCount ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={makeHref(page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
