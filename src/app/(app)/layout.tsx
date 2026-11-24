import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { getDefaultBusinessForUser } from "@/lib/tenant";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const business = await getDefaultBusinessForUser(session.user.id);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar businessName={business?.name ?? "Invoicing Platform"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          userName={session.user.name ?? "User"}
          userEmail={session.user.email ?? ""}
        />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
