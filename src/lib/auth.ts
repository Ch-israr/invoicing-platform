import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import { verifyCredentials } from "@/server/services/auth.service";
import { loginSchema } from "./validation/auth";
import { checkRateLimit } from "./rate-limit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT sessions — NOT database sessions. Auth.js v5 forbids the
  // Credentials provider with the database strategy
  // ("UnsupportedStrategy: Signing in with credentials only supported
  // if JWT strategy is enabled"). This is a deliberate deviation from
  // ARCHITECTURE.md §1.2, which said "DB sessions": with
  // email/password login, JWT is the only strategy Auth.js supports.
  // Sessions are signed with NEXTAUTH_SECRET and expire after 30 days.
  // Server-side session revocation (e.g. "log out everywhere") is a
  // known gap, tracked for Phase 8.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // 5 login attempts per minute per email, then a short lockout.
        const rl = checkRateLimit(`login:${email}`, 5, 60_000);
        if (!rl.allowed) return null;

        const user = await verifyCredentials(email, password);
        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
