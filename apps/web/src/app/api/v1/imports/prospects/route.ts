import { importProspects, prisma } from '@local-gtm/db';
import { parse } from 'csv-parse/sync';
import { apiError } from '@/lib/api-response';
import { getActiveRequestContext } from '@/lib/request-context';

interface CsvRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  organizationName?: string;
  organization?: string;
  industry?: string;
  title?: string;
}

export async function POST(request: Request) {
  try {
    const context = await getActiveRequestContext({ redirectOnMissing: false });
    if (!context) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey)
      return Response.json({ message: 'Idempotency-Key is required.' }, { status: 400 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > 5_000_000)
      return Response.json({ message: 'A CSV file up to 5 MB is required.' }, { status: 400 });
    const parsed: CsvRow[] = parse(await file.text(), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
    const rows = parsed.map((row) => ({
      organization: row.organizationName ?? row.organization ?? '',
      industry: row.industry ?? 'Law firm',
      firstName: row.firstName ?? '',
      lastName: row.lastName ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      title: row.title ?? '',
    }));
    const run = await importProspects(prisma, context, {
      filename: file.name,
      idempotencyKey,
      rows,
    });
    return Response.json(run, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
