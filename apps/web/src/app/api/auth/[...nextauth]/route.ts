import NextAuth from 'next-auth';
import { authOptions } from '@/auth';

// next-auth v4 exposes its App Router handler as `any`; confine that upstream type gap here.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
