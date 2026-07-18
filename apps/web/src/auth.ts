import type { NextAuthOptions } from 'next-auth';
import KeycloakProvider from 'next-auth/providers/keycloak';

export const authOptions: NextAuthOptions = {
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? 'local-gtm-web',
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? 'not-configured',
      issuer: process.env.KEYCLOAK_ISSUER ?? 'https://auth.example.invalid/realms/legal-crm',
    }),
  ],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  ...(process.env.AUTH_SECRET ? { secret: process.env.AUTH_SECRET } : {}),
  pages: { error: '/auth/error' },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account) {
        token.issuer = account.provider;
        token.subject = account.providerAccountId;
      }
      if (profile && 'email' in profile && typeof profile.email === 'string')
        token.email = profile.email;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.email !== undefined) session.user.email = token.email;
      return session;
    },
  },
};
