import { WorkspacePage } from '@/components/workspace-page';
import { getActiveRequestContext } from '@/lib/request-context';
import {
  getAccountingPeriods,
  getInvoices,
  getLedgerAccounts,
  getTimeEntries,
} from '@/lib/workspace-data';
import { FinanceActions } from '@/components/finance-actions';
export const dynamic = 'force-dynamic';
export default async function BillingPage() {
  const context = await getActiveRequestContext();
  const invoices = await getInvoices(context);
  const [timeEntries, accounts, periods] = await Promise.all([
    getTimeEntries(context),
    getLedgerAccounts(context),
    getAccountingPeriods(context),
  ]);
  return (
    <WorkspacePage
      context={context}
      eyebrow="Practice operations"
      title="Billing operations."
      lede="Record time, issue invoices, and review the current operational status for this tenant."
    >
      <FinanceActions timeEntries={timeEntries} accounts={accounts} periods={periods} />
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Invoices</h2>
          <span className="panel-kicker">{invoices.length}</span>
        </div>
        {invoices.length === 0 ? (
          <div className="empty">
            Financial features remain disabled until jurisdiction and professional approval are
            recorded.
          </div>
        ) : (
          invoices.map((i) => (
            <div className="deal-row" key={i.id}>
              <div className="deal-name">
                <strong>{i.invoiceNumber}</strong>
                <span>{i.matter.name}</span>
              </div>
              <span className="stage">{i.status}</span>
              <span className="value">${(i.amountCents / 100).toLocaleString()}</span>
              <span>{i.paidCents === i.amountCents ? 'Paid' : 'Open'}</span>
            </div>
          ))
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Recent time</h2>
          <span className="panel-kicker">{timeEntries.length}</span>
        </div>
        {timeEntries.map((entry) => (
          <div className="deal-row" key={entry.id}>
            <div className="deal-name">
              <strong>{entry.matter.name}</strong>
              <span>{entry.description}</span>
            </div>
            <span>{entry.minutes} min</span>
            <span>{entry.approvedAt ? 'Approved' : 'Pending'}</span>
            <span>{entry.invoicedAt ? 'Invoiced' : 'Uninvoiced'}</span>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Accounts & periods</h2>
          <span className="panel-kicker">{accounts.length + periods.length}</span>
        </div>
        {accounts.map((account) => (
          <div className="deal-row" key={account.id}>
            <strong>{account.name}</strong>
            <span>{account.type}</span>
            <span>{account.active ? 'Active' : 'Inactive'}</span>
          </div>
        ))}
        {periods.map((period) => (
          <div className="deal-row" key={period.id}>
            <strong>
              {period.startsAt.toLocaleDateString()} – {period.endsAt.toLocaleDateString()}
            </strong>
            <span>{period.status}</span>
            <span>{period.locks.length} locks</span>
          </div>
        ))}
      </section>
    </WorkspacePage>
  );
}
