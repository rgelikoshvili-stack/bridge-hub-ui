import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import './Expenses.css';

interface Expense {
  id: number | string;
  date?: string;
  created_at?: string;
  description?: string;
  category?: string;
  partner?: string;
  amount?: number;
  status?: string;
}

interface ExpenseSummary {
  total_amount?: number;
  pending_count?: number;
  approved_count?: number;
  categories_count?: number;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('ka-GE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status || '').toLowerCase();
  let cls = 'badge badge-pending';
  if (s === 'approved') cls = 'badge badge-approved';
  if (s === 'rejected') cls = 'badge badge-rejected';
  return <span className={cls}>{status || '—'}</span>;
}

export default function Expenses() {
  const [statusFilter, setStatusFilter] = useState('');

  const { data: listData, isFetching: listLoading, refetch } = useQuery({
    queryKey: ['expenses', statusFilter],
    queryFn: () => {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      return api.get(`/expenses/list${qs}`).then(r => r.data);
    },
    staleTime: 30000,
  });

  const { data: sumData } = useQuery<{ ok: boolean; data?: ExpenseSummary }>({
    queryKey: ['expenses-summary'],
    queryFn: () => api.get('/expenses/summary').then(r => r.data),
    staleTime: 60000,
  });

  const items: Expense[] = listData?.data?.expenses ?? listData?.expenses ?? listData?.data ?? [];
  const s: ExpenseSummary = sumData?.ok && sumData.data ? sumData.data : {};

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <div className="page__eyebrow">Financial · Expenses</div>
          <div className="page__title">ხარჯები <em>· expenses</em></div>
          <div className="page__subtitle">ყველა ხარჯი კატეგორიის მიხედვით, დამტკიცების სტატუსით.</div>
        </div>
        <div className="exp-actions">
          <select
            className="input exp-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">ყველა</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => refetch()} disabled={listLoading}>
            {listLoading ? <span className="spinner" /> : '↻'}
          </button>
        </div>
      </div>

      <div className="kpi-row-pills">
        <span className="kpi-pill kpi-pill--blue"><b>{fmtMoney(s.total_amount ?? 0)}</b> სულ</span>
        <span className="kpi-pill kpi-pill--amber"><b>{s.pending_count ?? 0}</b> pending</span>
        <span className="kpi-pill kpi-pill--green"><b>{s.approved_count ?? 0}</b> approved</span>
        <span className="kpi-pill kpi-pill--purple"><b>{s.categories_count ?? 0}</b> კატეგ.</span>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          {listLoading && !items.length ? (
            <div className="empty-state"><span className="spinner" /></div>
          ) : !items.length ? (
            <div className="empty-state">
              <div className="empty-ic">ø</div>
              <div className="empty-txt">ხარჯები არ არის</div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>თარიღი</th>
                  <th>აღწერა</th>
                  <th>კატ.</th>
                  <th>პარტნიორი</th>
                  <th className="num">თანხა</th>
                  <th>სტ.</th>
                </tr>
              </thead>
              <tbody>
                {items.map(e => (
                  <tr key={e.id}>
                    <td className="mono">#{e.id}</td>
                    <td className="mono">{e.date ?? (e.created_at ? e.created_at.slice(0, 10) : '—')}</td>
                    <td className="td-desc">{e.description ?? '—'}</td>
                    <td>
                      <span className="chip chip-draft">{e.category ?? '—'}</span>
                    </td>
                    <td className="mono" style={{ fontSize: '11.5px' }}>{e.partner ?? '—'}</td>
                    <td className="num mono text-red">{fmtMoney(e.amount ?? 0)}</td>
                    <td><StatusBadge status={e.status} /></td>
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
