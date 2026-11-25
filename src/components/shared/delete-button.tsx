"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Two-step delete: first click arms the button, second click submits
 * the enclosing <form>. No JavaScript confirm() dialog.
 */
export function DeleteButton({
  label = "Delete",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      type={armed ? "submit" : "button"}
      variant="destructive"
      size="sm"
      className={cn(className)}
      onClick={(e) => {
        if (!armed) {
          e.preventDefault();
          setArmed(true);
          window.setTimeout(() => setArmed(false), 4000);
        }
      }}
    >
      {armed ? "Click again to confirm" : label}
    </Button>
  );
}
