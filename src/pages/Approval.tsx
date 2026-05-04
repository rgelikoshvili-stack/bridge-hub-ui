import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import './Approval.css';

// ── TYPES ──────────────────────────────────────────────────────────────────

interface Draft {
  id: string;
  date?: string;
  created_at?: string;
  description?: string;
  narration?: string;
  memo?: string;
  amount?: number;
  status?: string;
  confidence?: number;
  ai_confidence?: number;
  account_code?: string;
  debit_account?: string;
  credit_account?: string;
  partner?: string;
  counterparty_name?: string;
  source_document_id?: string;
  classification_source?: string;
  source?: string;
  rejection_reason?: string;
  reason?: string;
  journal_entries?: unknown;
  raw_extraction?: unknown;
  attached_file_name?: string;
  currency?: string;
}

interface JournalEntry { debit_account?: string; credit_account?: string; description?: string; amount?: number; }

interface PostingPreview {
  ok: boolean;
  draft_id?: string;
  draft?: {
    id?: string; description?: string; amount?: number; status?: string;
    confidence?: number; date?: string; debit_account?: string; credit_account?: string;
    partner?: string; currency?: string; source_document_id?: string;
    attached_file_name?: string; journal_entries?: unknown; raw_extraction?: unknown;
  };
  impact?: {
    debit_category?: string; credit_category?: string;
    pl_direction?: string; pl_impact?: number; vat_change?: number; tax_impact?: number;
    notes?: string[]; summary?: string; currency?: string;
  };
  error?: { details?: string };
  message?: string;
}

type ConfFilter = 'all' | 'high' | 'mid' | 'low';
type Tab = 'all' | 'pending' | 'approved' | 'rejected';

// ── HELPERS ────────────────────────────────────────────────────────────────

const fmt2 = (v?: number) =>
  (Number(v) || 0).toLocaleString('ka-GE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₾';
const fmt0 = (v?: number) =>
  (Number(v) || 0).toLocaleString('ka-GE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (s?: string) =>
  s ? new Date(s).toLocaleDateString('ka-GE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const getDesc = (r: Draft) => r.description || r.narration || r.memo || '—';
const getConf = (r: Draft) => r.confidence || r.ai_confidence || 0;
const getSource = (r: Draft) => r.classification_source || r.source || 'manual';
const getRejReason = (r: Draft) => r.rejection_reason || r.reason || '—';

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'მოლოდინი', approved: '✓ დამტ.', rejected: '✕ უარ.',
  drafted: 'draft', needs_review: 'review',
};
const STATUS_CLS: Record<string, string> = {
  pending_approval: 'chip chip-pending', approved: 'chip chip-approved',
  rejected: 'chip chip-rejected', drafted: 'chip chip-draft', needs_review: 'chip chip-pending',
};
function StatusChip({ status }: { status?: string }) {
  const s = status || '';
  return <span className={STATUS_CLS[s] || 'chip chip-draft'}>{STATUS_LABEL[s] || s || '—'}</span>;
}

function ConfBar({ value }: { value: number }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? '#EF9F27' : 'var(--red)';
  return (
    <div className="conf-bar">
      <div className="conf-track"><div className="conf-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="conf-pct">{pct}%</span>
    </div>
  );
}

// ── TOAST ──────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((msg: string, type = 'ok') => {
    setToast({ msg, type });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  return { toast, show };
}
function Toast({ t }: { t: { msg: string; type: string } | null }) {
  if (!t) return null;
  return <div className={`a-toast a-toast--${t.type}`}>{t.msg}</div>;
}

// ── DOCUMENT VIEWER ────────────────────────────────────────────────────────

async function viewDoc(draftId: string) {
  const token = localStorage.getItem('access_token') || localStorage.getItem('bh_token') || '';
  const h: Record<string, string> = token ? { Authorization: 'Bearer ' + token } : {};

  let srcId: string | null = null;
  try {
    const r = await fetch('/posting/preview/' + draftId, { headers: h });
    const j = await r.json();
    srcId = j?.draft?.source_document_id || null;
  } catch (_e) { /* ignore */ }

  if (!srcId) {
    try {
      const ar = await fetch('/approval/draft/' + draftId + '/attachment', { headers: h });
      if (ar.ok) {
        const aj = await ar.json();
        const su = aj?.data?.signed_url;
        if (su) { window.open(su, '_blank'); return; }
      }
    } catch (_e) { /* ignore */ }
    alert('ამ გატარებაზე დოკუმენტი არ არის მიბმული');
    return;
  }

  try {
    const ur = await fetch('/documents/' + srcId + '/url', { headers: h });
    if (ur.ok) { const ud = await ur.json(); if (ud?.data?.signed_url) { window.open(ud.data.signed_url, '_blank'); return; } }
  } catch (_e) { /* ignore */ }

  try {
    const resp = await fetch('/documents/' + srcId + '/file', { headers: h });
    if (!resp.ok) { alert('დოკუმენტი ვერ მოიძებნა'); return; }
    const blob = await resp.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (_e) { alert('ჩამოტვირთვის შეცდომა'); }
}

// ── ROW MENU ───────────────────────────────────────────────────────────────

interface MenuProps {
  id: string; pos: { x: number; y: number }; onClose: () => void;
  onPreview: () => void; onEdit: () => void; onViewDoc: () => void;
  onApprove: () => void; onReject: () => void; onDelete: () => void;
}
function RowMenu({ pos, onClose, onPreview, onEdit, onViewDoc, onApprove, onReject, onDelete }: MenuProps) {
  const items: (null | { icon: string; label: string; color: string; fn: () => void })[] = [
    { icon: '👁', label: 'დეტალები', color: '#3a5a8c', fn: onPreview },
    { icon: '✏️', label: 'კორექტირება', color: '#fd7e14', fn: onEdit },
    { icon: '📄', label: 'ფაილის ნახვა', color: '#17a2b8', fn: onViewDoc },
    null,
    { icon: '✅', label: 'დამტკიცება', color: '#28a745', fn: onApprove },
    { icon: '❌', label: 'უარყოფა', color: '#dc3545', fn: onReject },
    null,
    { icon: '🗑️', label: 'წაშლა', color: '#6b7280', fn: onDelete },
  ];
  return (
    <>
      <div className="row-menu-bd" onClick={onClose} />
      <div className="row-menu" style={{ left: Math.max(8, pos.x), top: pos.y }}>
        {items.map((item, i) =>
          item === null
            ? <div key={i} className="row-menu-sep" />
            : <div key={i} className="row-menu-item" onClick={() => { onClose(); item.fn(); }}>
                <span>{item.icon}</span>
                <span style={{ color: item.color }}>{item.label}</span>
              </div>
        )}
      </div>
    </>
  );
}

// ── REJECT MODAL ───────────────────────────────────────────────────────────

function RejectModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    await api.post(`/approval/reject/${id}`, { reason: reason || 'no reason' });
    setLoading(false); onDone(); onClose();
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">უარყოფის მიზეზი <span className="modal-id">#{id.slice(-6)}</span></div>
        <textarea className="input modal-textarea" placeholder="მიზეზი…" value={reason}
          onChange={e => setReason(e.target.value)} autoFocus />
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>გაუქმება</button>
          <button className="btn btn-danger" onClick={submit} disabled={loading}>
            {loading ? <span className="spinner" /> : '✕ უარყოფა'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PREVIEW MODAL ──────────────────────────────────────────────────────────

const CAT_LABEL: Record<string, string> = {
  expense: 'ხარჯი', income: 'შემოსავალი', asset: 'აქტივი',
  liability: 'ვალდებულება', vat: 'დღგ', tax: 'გადასახადი', other: 'სხვა',
};

function PreviewModal({ id, onClose, onApprove, onReject }: {
  id: string; onClose: () => void; onApprove: () => void; onReject: () => void;
}) {
  const { data, isLoading, isError } = useQuery<PostingPreview>({
    queryKey: ['posting-preview', id],
    queryFn: () => api.get(`/posting/preview/${id}`).then(r => r.data),
    staleTime: 60000,
  });

  let body: React.ReactNode = null;
  if (isLoading) {
    body = <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /></div>;
  } else if (isError || !data?.ok) {
    body = <div className="pp-error">✕ {data?.error?.details || data?.message || 'Preview ვერ მოიძებნა'}</div>;
  } else {
    const dr = data.draft || {};
    const imp = data.impact || {};
    const confPct = dr.confidence != null ? Math.round(dr.confidence * 100) : null;
    const confColor = confPct == null ? 'var(--ink-dim)' : confPct >= 85 ? 'var(--green)' : confPct >= 60 ? '#EF9F27' : 'var(--red)';
    const amt = dr.amount || 0;

    let jeArr: JournalEntry[] = [];
    try {
      const raw = dr.journal_entries;
      jeArr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw as JournalEntry[]) : [];
    } catch (_e) { /* ignore */ }

    const drCat = CAT_LABEL[imp.debit_category || ''] || imp.debit_category || '';
    const crCat = CAT_LABEL[imp.credit_category || ''] || imp.credit_category || '';
    const notes: string[] = imp.notes?.length ? imp.notes : imp.summary ? [imp.summary] : [];
    const plSign = imp.pl_direction === 'increase' ? '+' : imp.pl_direction === 'decrease' ? '−' : '';
    const plCls = imp.pl_direction === 'increase' ? 'kpi-pill kpi-green' : imp.pl_direction === 'decrease' ? 'kpi-pill kpi-red' : 'kpi-pill';

    body = <>
      <div className="pp-section">
        <div className="pp-sec-label">Draft Summary</div>
        <div className="pp-grid">
          <div><span className="pp-k">Draft ID</span><span className="pp-v mono">#{data.draft_id}</span></div>
          <div><span className="pp-k">Status</span><span className="pp-v"><StatusChip status={dr.status} /></span></div>
          <div style={{ gridColumn: '1/-1' }}><span className="pp-k">Description</span><span className="pp-v" style={{ fontWeight: 600 }}>{dr.description || '—'}</span></div>
          <div style={{ gridColumn: '1/-1' }}><span className="pp-k">Partner</span><span className="pp-v">{dr.partner || '—'}</span></div>
          <div><span className="pp-k">Amount</span><span className="pp-v" style={{ fontWeight: 700, fontSize: 15 }}>{fmt2(amt)} {imp.currency || dr.currency || 'GEL'}</span></div>
          <div><span className="pp-k">Confidence</span><span className="pp-v" style={{ fontWeight: 700, color: confColor }}>{confPct != null ? confPct + '%' : '—'}</span></div>
          {dr.date && <div><span className="pp-k">Date</span><span className="pp-v mono">{dr.date}</span></div>}
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-sec-label">Journal Lines</div>
        <div className="pp-je">
          {jeArr.length > 1 ? jeArr.map((e, i) => {
            const side = e.debit_account ? 'Dr' : 'Cr';
            const acc = e.debit_account || e.credit_account || '—';
            return (
              <div key={i} className={`je-row je-${side.toLowerCase()}`}>
                <span className="je-side">{side}</span>
                <span className="je-acc">{acc}</span>
                {e.description && <span className="je-note">{e.description}</span>}
                <span className="je-amt">{fmt2(e.amount)}</span>
              </div>
            );
          }) : <>
            <div className="je-row je-dr">
              <span className="je-side">Dr</span>
              <span className="je-acc">{dr.debit_account || '—'}</span>
              {drCat && <span className="je-note">{drCat}</span>}
              <span className="je-amt">{fmt2(amt)}</span>
            </div>
            <div className="je-row je-cr">
              <span className="je-side">Cr</span>
              <span className="je-acc">{dr.credit_account || '—'}</span>
              {crCat && <span className="je-note">{crCat}</span>}
              <span className="je-amt">{fmt2(amt)}</span>
            </div>
          </>}
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-sec-label">Impact</div>
        <div className="pp-pills">
          <span className={plCls}>P&amp;L: <b>{imp.pl_impact != null ? plSign + fmt2(Math.abs(imp.pl_impact)) : '—'}</b></span>
          <span className="kpi-pill kpi-amber">VAT: <b>{imp.vat_change != null ? (imp.vat_change > 0 ? '+' : '') + fmt2(imp.vat_change) : '—'}</b></span>
          <span className="kpi-pill kpi-purple">TAX: <b>{imp.tax_impact != null ? fmt2(imp.tax_impact) : '—'}</b></span>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="pp-section">
          <div className="pp-sec-label">Explanation</div>
          <div className="pp-notes"><ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
        </div>
      )}

      <div className="pp-section">
        <div className="pp-sec-label">დამხმარე ფაილი</div>
        <div className="pp-file">
          <span>📎 {dr.attached_file_name || 'ფაილი არ არის მიბმული'}</span>
          {(dr.attached_file_name || dr.source_document_id) && (
            <button className="btn btn-ghost btn-sm" onClick={() => viewDoc(id)}>👁 ნახვა</button>
          )}
        </div>
      </div>
    </>;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pp-modal" onClick={e => e.stopPropagation()}>
        <div className="pp-header">
          <div className="pp-title">Draft <em>#{id.slice(-6)}</em></div>
          <button className="pp-close" onClick={onClose}>✕</button>
        </div>
        <div className="pp-body">{body}</div>
        <div className="pp-footer">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>დახურვა</button>
          {data?.ok && <>
            <button className="btn btn-danger btn-sm" onClick={() => { onClose(); onReject(); }}>✕ უარყოფა</button>
            <button className="btn btn-success btn-sm" onClick={() => { onClose(); onApprove(); }}>✓ დამტკიცება</button>
          </>}
        </div>
      </div>
    </div>
  );
}

// ── CORRECTION MODAL ───────────────────────────────────────────────────────

interface ExtraLine { side: 'Dr' | 'Cr'; acc: string; note: string; amt: string; }

function CorrectionModal({ id, onClose, onDone, showToast }: {
  id: string; onClose: () => void; onDone: () => void; showToast: (m: string, t?: string) => void;
}) {
  const [debit, setDebit] = useState('');
  const [credit, setCredit] = useState('');
  const [reason, setReason] = useState('');
  const [extra, setExtra] = useState<ExtraLine[]>([]);
  const [loading, setLoading] = useState(false);

  const { data, isLoading } = useQuery<PostingPreview>({
    queryKey: ['posting-preview', id],
    queryFn: () => api.get(`/posting/preview/${id}`).then(r => r.data),
    staleTime: 60000,
  });

  useEffect(() => {
    if (data?.draft) {
      setDebit(data.draft.debit_account || '');
      setCredit(data.draft.credit_account || '');
    }
  }, [data]);

  const dr = data?.draft || {};
  let rawExt: Record<string, unknown> = {};
  try {
    const raw = dr.raw_extraction;
    if (raw) rawExt = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;
  } catch (_e) { /* ignore */ }

  const seller = rawExt.seller as Record<string, unknown> | undefined;
  const invNum = String(rawExt.document_number || rawExt.invoice_number || rawExt.number || '');
  const supplier = String(seller?.name || rawExt.counterparty_name || dr.partner || '');
  const supplierInn = String(seller?.inn || rawExt.seller_inn || '');
  const invDate = String(rawExt.issue_date || dr.date || '');
  const fileUrl = dr.source_document_id ? '/documents/' + dr.source_document_id + '/file' : null;

  const addLine = () => setExtra(l => [...l, { side: 'Dr', acc: '', note: '', amt: '' }]);
  const rmLine = (i: number) => setExtra(l => l.filter((_, idx) => idx !== i));
  const upLine = (i: number, k: keyof ExtraLine, v: string) =>
    setExtra(l => l.map((x, idx) => idx === i ? { ...x, [k]: v } : x));

  const submit = async () => {
    if (!debit || !credit) { showToast('Dr და Cr ანგარიშები სავალდებულოა', 'warn'); return; }
    setLoading(true);
    try {
      const r = await api.post(`/approval/correct/${id}`, {
        debit_account: debit, credit_account: credit,
        reason: reason || null, user: 'human',
      });
      if (r.data?.ok) { showToast('✓ კორექტირება შენახდა'); onDone(); onClose(); }
      else showToast('შეცდომა: ' + (r.data?.error?.details || r.data?.message || 'unknown'), 'err');
    } catch (_e) { showToast('Network error', 'err'); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pp-modal" onClick={e => e.stopPropagation()}>
        <div className="pp-header">
          <div className="pp-title">კორექტირება <em>#{id.slice(-6)}</em></div>
          <button className="pp-close" onClick={onClose}>✕</button>
        </div>
        <div className="pp-body">
          {isLoading ? <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></div> : <>
            {(supplier || invNum || dr.source_document_id) && (
              <div className="corr-doc-card">
                <div className="corr-doc-head">
                  <span style={{ fontSize: 18 }}>📄</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {dr.source_document_id ? 'Document #' + dr.source_document_id : dr.attached_file_name || 'დოკუმენტი'}
                    </div>
                    {invNum && <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>ინვოისი #{invNum}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {dr.source_document_id && <button className="btn btn-ghost btn-sm" onClick={() => viewDoc(id)}>👁</button>}
                    {fileUrl && <a className="btn btn-ghost btn-sm" href={fileUrl} target="_blank" rel="noreferrer" download>⬇</a>}
                  </div>
                </div>
                <div className="corr-doc-grid">
                  {invDate && <div><span className="pp-k">თარიღი</span><span className="pp-v">{invDate}</span></div>}
                  {supplier && <div style={{ gridColumn: '1/-1' }}><span className="pp-k">მომწოდებელი</span><span className="pp-v" style={{ fontWeight: 700 }}>{supplier}</span></div>}
                  {supplierInn && <div><span className="pp-k">INN</span><span className="pp-v mono">{supplierInn}</span></div>}
                </div>
              </div>
            )}

            <div className="pp-section">
              <div className="pp-sec-label">Journal Lines — კორექტირება</div>
              <div className="corr-je">
                <div className="corr-je-row corr-dr">
                  <span className="corr-side corr-side-dr">Dr</span>
                  <input className="corr-acc" value={debit} onChange={e => setDebit(e.target.value)} placeholder="ანგარიში…" />
                  <span className="corr-amt">{fmt2(dr.amount)}</span>
                </div>
                <div className="corr-je-row corr-cr">
                  <span className="corr-side corr-side-cr">Cr</span>
                  <input className="corr-acc" value={credit} onChange={e => setCredit(e.target.value)} placeholder="ანგარიში…" />
                  <span className="corr-amt">{fmt2(dr.amount)}</span>
                </div>
                {extra.map((line, i) => (
                  <div key={i} className="corr-je-row corr-extra">
                    <select className="corr-extra-side" value={line.side}
                      onChange={e => upLine(i, 'side', e.target.value as 'Dr' | 'Cr')}>
                      <option>Dr</option><option>Cr</option>
                    </select>
                    <input className="corr-acc" value={line.acc} onChange={e => upLine(i, 'acc', e.target.value)} placeholder="ანგარიში…" />
                    <input className="corr-extra-note" value={line.note} onChange={e => upLine(i, 'note', e.target.value)} placeholder="ხარჯი…" />
                    <input className="corr-extra-amt" type="number" value={line.amt} onChange={e => upLine(i, 'amt', e.target.value)} placeholder="₾" />
                    <button className="corr-extra-rm" onClick={() => rmLine(i)}>✕</button>
                  </div>
                ))}
                <div className="corr-add-row">
                  <button className="btn btn-ghost btn-sm" onClick={addLine}>+ მუხლის დამატება</button>
                </div>
              </div>
            </div>

            <div className="pp-section">
              <div className="pp-sec-label">კომენტარი / მიზეზი</div>
              <textarea className="input" rows={3} style={{ resize: 'vertical', fontSize: 13 }}
                placeholder="კორექტირების მიზეზი…" value={reason} onChange={e => setReason(e.target.value)} />
            </div>
          </>}
        </div>
        <div className="pp-footer">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>გაუქმება</button>
          <button className="btn btn-success btn-sm" onClick={submit} disabled={loading}>
            {loading ? <span className="spinner" /> : '💾 შენახვა'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── API FETCH ──────────────────────────────────────────────────────────────

function fetchQueue(status?: string) {
  const p = new URLSearchParams({ limit: '200' });
  if (status) p.set('status', status);
  return api.get(`/approval/queue?${p}`).then(r => r.data);
}
function extractRows(d: unknown): Draft[] {
  if (!d) return [];
  const dd = (d as Record<string, unknown>).data as Record<string, unknown> | undefined;
  return (dd?.queue || dd?.items || (d as Record<string, unknown>).items || []) as Draft[];
}

// ── MAIN ───────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'ყველა' },
  { key: 'pending', label: 'მოლოდინში' },
  { key: 'approved', label: 'დამტკიცებული' },
  { key: 'rejected', label: 'უარყოფილი' },
];

export default function Approval() {
  const [tab, setTab] = useState<Tab>('pending');
  const [confFilter, setConfFilter] = useState<ConfFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [corrId, setCorrId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const { toast, show: showToast } = useToast();
  const qc = useQueryClient();

  const { data: pendD, isLoading: pendL } = useQuery({ queryKey: ['approval', 'pending'], queryFn: () => fetchQueue(), staleTime: 15000, refetchInterval: 30000 });
  const { data: appD, isLoading: appL } = useQuery({ queryKey: ['approval', 'approved'], queryFn: () => fetchQueue('approved'), staleTime: 30000 });
  const { data: rejD, isLoading: rejL } = useQuery({ queryKey: ['approval', 'rejected'], queryFn: () => fetchQueue('rejected'), staleTime: 30000 });

  const pending = extractRows(pendD);
  const approved = extractRows(appD);
  const rejected = extractRows(rejD);
  const all = [...pending, ...approved, ...rejected];

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['approval'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }, [qc]);

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/approval/approve/${id}`),
    onSuccess: (_d, id) => { showToast('✓ დამტკიცდა #' + id.slice(-6)); invalidate(); },
    onError: () => showToast('დამტკიცება ვერ მოხერხდა', 'err'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/approval/draft/${id}`),
    onSuccess: (_d, id) => { showToast('🗑 წაშლილია #' + id.slice(-6), 'warn'); invalidate(); },
    onError: () => showToast('წაშლა ვერ მოხერხდა', 'err'),
  });
  const batchMut = useMutation({
    mutationFn: ({ action, ids }: { action: string; ids: string[] }) =>
      api.post('/approval/batch-action', { action, draft_ids: ids.map(Number) }),
    onSuccess: (d, { action }) => {
      const cnt = (d as { data?: { affected?: number } }).data?.affected || selected.size;
      showToast(`✓ ${cnt} — ${action === 'approve' ? 'დამტკიცდა' : 'უარყოფილია'}`);
      setSelected(new Set()); invalidate();
    },
    onError: () => showToast('Batch error', 'err'),
  });

  const handleApprove = (id: string) => approveMut.mutate(id);
  const handleDelete = (id: string) => {
    if (!window.confirm(`Draft #${id.slice(-6)} წაიშლება?`)) return;
    deleteMut.mutate(id);
  };

  const rawRows = tab === 'pending' ? pending : tab === 'approved' ? approved : tab === 'rejected' ? rejected : all;
  let rows = rawRows;
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r => [r.id, r.date, getDesc(r), String(r.amount || ''), r.account_code, r.debit_account].join(' ').toLowerCase().includes(q));
  }
  if (tab === 'pending' && confFilter !== 'all') {
    rows = rows.filter(r => {
      const pct = Math.round(getConf(r) * 100);
      if (confFilter === 'high') return pct >= 80;
      if (confFilter === 'mid') return pct >= 50 && pct < 80;
      return pct < 50;
    });
  }

  const isLoading = tab === 'pending' ? pendL : tab === 'approved' ? appL : tab === 'rejected' ? rejL : (pendL || appL || rejL);
  const counts = { all: all.length, pending: pending.length, approved: approved.length, rejected: rejected.length };

  const toggleRow = (id: string, checked: boolean) => setSelected(s => { const n = new Set(s); checked ? n.add(id) : n.delete(id); return n; });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map(r => r.id)) : new Set());

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setRowMenu({ id, x: rect.left - 190, y: rect.bottom + 6 });
  };

  const approveAll = async () => {
    if (!window.confirm(`ყველა ${pending.length} draft-ი დამტკიცდეს?`)) return;
    let ok = 0, fail = 0;
    for (const r of pending) {
      try { await api.post(`/approval/approve/${r.id}`); ok++; } catch { fail++; }
    }
    showToast(`✓ ${ok} დამტ.${fail ? ` · ${fail} შეცდ.` : ''}`, ok ? 'ok' : 'err');
    invalidate();
  };

  return (
    <div className="page">
      <Toast t={toast} />

      {previewId && <PreviewModal id={previewId} onClose={() => setPreviewId(null)}
        onApprove={() => handleApprove(previewId)} onReject={() => { setPreviewId(null); setRejectId(previewId); }} />}
      {corrId && <CorrectionModal id={corrId} onClose={() => setCorrId(null)} onDone={invalidate} showToast={showToast} />}
      {rejectId && <RejectModal id={rejectId} onClose={() => setRejectId(null)} onDone={invalidate} />}
      {rowMenu && <RowMenu id={rowMenu.id} pos={{ x: rowMenu.x, y: rowMenu.y }} onClose={() => setRowMenu(null)}
        onPreview={() => setPreviewId(rowMenu.id)} onEdit={() => setCorrId(rowMenu.id)}
        onViewDoc={() => viewDoc(rowMenu.id)} onApprove={() => handleApprove(rowMenu.id)}
        onReject={() => setRejectId(rowMenu.id)} onDelete={() => handleDelete(rowMenu.id)} />}

      {/* Header */}
      <div className="page__header">
        <div>
          <div className="page__title">Journal <em style={{ fontStyle: 'italic', fontWeight: 400, color: 'var(--ink-dim)', fontSize: 18 }}>Drafts</em></div>
          <div className="page__subtitle">დამტკიცების რიგი · ისტორია · ფილტრები</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'pending' && pending.length > 0 && (
            <button className="btn btn-success btn-sm" onClick={approveAll}>✓ ყველა ({pending.length})</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={invalidate}>↻ განახლება</button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="stats-strip">
        <div className="stat-card"><div className="stat-label">სულ</div><div className="stat-val">{all.length}</div><div className="stat-sub">all drafts</div></div>
        <div className="stat-card stat-amber"><div className="stat-label">მოლოდინში</div><div className="stat-val" style={{ color: '#7a4f00' }}>{pending.length}</div><div className="stat-sub">pending approval</div></div>
        <div className="stat-card stat-green"><div className="stat-label">დამტკიცებული</div><div className="stat-val" style={{ color: 'var(--green)' }}>{approved.length}</div><div className="stat-sub">approved</div></div>
        <div className="stat-card stat-red"><div className="stat-label">უარყოფილი</div><div className="stat-val" style={{ color: 'var(--red)' }}>{rejected.length}</div><div className="stat-sub">rejected</div></div>
      </div>

      {/* Tabs */}
      <div className="drafts-tabs">
        {TABS.map(t => (
          <div key={t.key} className={`drafts-tab${tab === t.key ? ' drafts-tab--active' : ''}`}
            onClick={() => { setTab(t.key); setSearch(''); setSelected(new Set()); setConfFilter('all'); }}>
            {t.label}
            <span className={`dtab-badge${tab === t.key ? ' dtab-badge--active' : ''}`}>{counts[t.key]}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="approval-toolbar">
        <div className="search-box" style={{ maxWidth: 320 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input placeholder="ძებნა…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {tab === 'pending' && (
          <div className="conf-chips">
            {(['all', 'high', 'mid', 'low'] as ConfFilter[]).map(f => (
              <button key={f} className={`conf-chip${confFilter === f ? ' conf-chip--active' : ''}`}
                onClick={() => setConfFilter(f)}>
                {f === 'all' ? 'ყველა' : f === 'high' ? '≥80%' : f === 'mid' ? '50-79%' : '<50%'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk Bar */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-info">{selected.size} არჩეული</span>
          <button className="btn btn-success btn-sm" onClick={() => batchMut.mutate({ action: 'approve', ids: Array.from(selected) })}>✓ დამტ.</button>
          <button className="btn btn-danger btn-sm" onClick={() => batchMut.mutate({ action: 'reject', ids: Array.from(selected) })}>✕ უარ.</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--paper)' }} onClick={() => setSelected(new Set())}>გაუქმება</button>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" onChange={e => toggleAll(e.target.checked)}
                    checked={rows.length > 0 && selected.size === rows.length} />
                </th>
                <th>ID</th><th>თარიღი</th><th>აღწ.</th>
                <th style={{ textAlign: 'right' }}>თანხა</th>
                <th>კატ.</th><th>კონფ.</th>
                {tab === 'rejected' ? <th>მიზეზი</th> : <th>წყარო</th>}
                <th>სტ.</th><th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10}><div className="empty-state"><div className="empty-ic">ø</div><div className="empty-txt">ჩანაწერები არ მოიძებნა</div></div></td></tr>
              ) : rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setPreviewId(r.id)}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={e => toggleRow(r.id, e.target.checked)} />
                  </td>
                  <td className="mono text-dim" style={{ fontSize: 11 }}>#{r.id.slice(-6)}</td>
                  <td className="mono text-dim">{fmtDate(r.date || r.created_at)}</td>
                  <td className="approval-desc" title={getDesc(r)}>{getDesc(r)}</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>{fmt0(r.amount)}</td>
                  <td><span className="chip chip-draft" style={{ fontSize: 10 }}>{r.account_code || r.debit_account || '—'}</span></td>
                  <td><ConfBar value={getConf(r)} /></td>
                  {tab === 'rejected'
                    ? <td className="text-soft" style={{ fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={getRejReason(r)}>{getRejReason(r)}</td>
                    : <td className="mono text-dim" style={{ fontSize: 11 }}>{getSource(r)}</td>}
                  <td><StatusChip status={r.status} /></td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {tab === 'pending' && (
                        <button className="act act-view" title="ფაილი" onClick={() => viewDoc(r.id)}>👁</button>
                      )}
                      <button className="act act-menu" onClick={e => openMenu(e, r.id)}>⋯</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
