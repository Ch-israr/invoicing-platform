import { prisma } from "../src/lib/prisma";
import { registerUserAccount } from "../src/server/services/auth.service";

/**
 * Seed script (prisma db seed). Two independent, env-gated paths:
 *
 * 1. Admin bootstrap (first deploy): set ADMIN_EMAIL + ADMIN_PASSWORD
 *    to create the first owner account. The password is never
 *    hardcoded and never logged; set only one of the two and nothing
 *    is created. Remove the variables after the first run (or leave
 *    them — an existing user is never overwritten).
 * 2. Demo data (staging only): runs ONLY when DEMO_SEED=1.
 *
 * Production is never seeded with demo data — the dashboard must show
 * real data or empty states, never demo numbers.
 */
async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      console.log(`Admin user ${adminEmail} already exists — nothing to do.`);
    } else {
      const result = await registerUserAccount({
        name: process.env.ADMIN_NAME ?? "Admin",
        businessName: process.env.ADMIN_BUSINESS_NAME ?? "Admin Business",
        email: adminEmail,
        password: adminPassword,
      });
      if (!result.ok) {
        throw new Error(`Admin seed failed: ${result.error}`);
      }
      console.log(`Admin user created: ${adminEmail} / business ${result.businessId}`);
    }
  } else if (adminEmail || adminPassword) {
    console.log("Admin seed skipped: set both ADMIN_EMAIL and ADMIN_PASSWORD.");
  }

  if (process.env.DEMO_SEED !== "1") {
    if (!adminEmail && !adminPassword) {
      console.log(
        "Seed skipped: set DEMO_SEED=1 for demo data or ADMIN_EMAIL/ADMIN_PASSWORD for an admin user.",
      );
    }
    return;
  }

  const email = process.env.DEMO_EMAIL ?? "demo@invoicing.local";
  const password = process.env.DEMO_PASSWORD ?? "DemoPass1234";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Demo user ${email} already exists — nothing to do.`);
    return;
  }

  const result = await registerUserAccount({
    name: "Demo User",
    businessName: "Demo Trading LLC",
    email,
    password,
  });
  if (!result.ok) {
    throw new Error(`Demo seed failed: ${result.error}`);
  }
  console.log(`Demo seed created: ${email} / business ${result.businessId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
