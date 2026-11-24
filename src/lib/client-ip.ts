import { headers } from "next/headers";
import { clientIpFromHeaders } from "./rate-limit";

/**
 * Client IP inside a Server Action (where there is no Request object).
 * Reads the proxy headers via next/headers. Kept in its own module so
 * the pure rate-limit helper stays importable from non-request code
 * (services, tests) without pulling in next/headers.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h);
}
