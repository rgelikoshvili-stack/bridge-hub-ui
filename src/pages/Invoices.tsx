import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import './Invoices.css';

interface Invoice {
  id: number | string;
  invoice_number?: string;
  partner?: string;
  client?: string;
  customer_name?: string;
  total?: number;
  amount?: number;
  paid_amount?: number;
  due_date?: string;
  status?: string;
}

interface InvoiceSummary {
  total_invoices?: number;
  total_paid?: number;
  total_pending?: number;
  overdue_count?: number;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('ka-GE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status || '').toLowerCase();
  let cls = 'badge badge-pending';
  if (s === 'paid') cls = 'badge badge-approved';
  if (s === 'overdue') cls = 'badge badge-rejected';
  if (s === 'draft') cls = 'badge badge-auto';
  if (s === 'sent') cls = 'badge badge-pending';
  return <span className={cls}>{status || '—'}</span>;
}

export default function Invoices() {
  const [statusFilter, setStatusFilter] = useState('');

  const { data: listData, isFetching: listLoading, refetch } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: () => {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      return api.get(`/invoices/list${qs}`).then(r => r.data);
    },
    staleTime: 30000,
  });

  const { data: sumData } = useQuery<{ ok: boolean; data?: InvoiceSummary }>({
    queryKey: ['invoices-summary'],
    queryFn: () => api.get('/invoices/stats/summary').then(r => r.data),
    staleTime: 60000,
  });

  const items: Invoice[] = listData?.data?.invoices ?? listData?.invoices ?? listData?.data ?? [];
  const s: InvoiceSummary = sumData?.ok && sumData.data ? sumData.data : {};

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <div className="page__eyebrow">Financial · Invoices</div>
          <div className="page__title">ინვოისები <em>· issued</em></div>
          <div className="page__subtitle">გაცემული ინვოისები, გადახდის სტატუსი და ვადები.</div>
        </div>
        <div className="inv-actions">
          <select
            className="input inv-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">ყველა</option>
            <option value="draft">draft</option>
            <option value="sent">sent</option>
            <option value="paid">paid</option>
            <option value="overdue">overdue</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => refetch()} disabled={listLoading}>
            {listLoading ? <span className="spinner" /> : '↻'}
          </button>
        </div>
      </div>

      <div className="kpi-row-pills">
        <span className="kpi-pill"><b>{s.total_invoices ?? items.length ?? 0}</b> სულ</span>
        <span className="kpi-pill kpi-pill--green"><b>{fmtMoney(s.total_paid ?? 0)}</b> გადახდილი</span>
        <span className="kpi-pill kpi-pill--amber"><b>{fmtMoney(s.total_pending ?? 0)}</b> pending</span>
        <span className="kpi-pill kpi-pill--red"><b>{s.overdue_count ?? 0}</b> ვადაგასული</span>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          {listLoading && !items.length ? (
            <div className="empty-state"><span className="spinner" /></div>
          ) : !items.length ? (
            <div className="empty-state">
              <div className="empty-ic">ø</div>
              <div className="empty-txt">ინვოისები არ მოიძებნა</div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>ნომერი</th>
                  <th>კლიენტი</th>
                  <th className="num">ჯამი</th>
                  <th className="num">გადახდილი</th>
                  <th>ვადა</th>
                  <th>სტ.</th>
                </tr>
              </thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id}>
                    <td className="mono">#{i.id}</td>
                    <td className="mono">{i.invoice_number ?? '—'}</td>
                    <td>{i.partner ?? i.client ?? i.customer_name ?? '—'}</td>
                    <td className="num mono">{fmtMoney(i.total ?? i.amount ?? 0)}</td>
                    <td className="num mono text-green">{i.paid_amount != null ? fmtMoney(i.paid_amount) : '—'}</td>
                    <td className="mono">{i.due_date ?? '—'}</td>
                    <td><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
