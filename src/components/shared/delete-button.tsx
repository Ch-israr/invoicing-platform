"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Two-step delete: first click arms the button, second click submits
 * the enclosing <form>. No JavaScript confirm() dialog.
 */
export function DeleteButton({ label = "Delete" }: { label?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      type={armed ? "submit" : "button"}
      variant="destructive"
      size="sm"
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
