"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Opens the browser print dialog when the print view loads, and
 * offers a button to re-open it (e.g. if the first dialog was
 * dismissed). Hidden from the printed output by the parent page.
 */
export function PrintButton() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Print
    </Button>
  );
}
