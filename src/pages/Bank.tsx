import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import './Bank.css';

interface BankStatus {
  ok: boolean;
  banks?: {
    tbc?: { connected?: boolean; status?: string; message?: string; mode?: string; last_sync?: string; queued_count?: number; tx_count?: number };
    bog?: { connected?: boolean; status?: string; message?: string; mode?: string; last_sync?: string; queued_count?: number; tx_count?: number };
  };
}

interface SyncResult {
  ok: boolean;
  count?: number;
  tbc?: { count?: number };
  bog?: { count?: number };
  [key: string]: unknown;
}

function fmtDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('ka-GE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

export default function Bank() {
  const qc = useQueryClient();
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'ok' | 'err' | 'info'>('info');
  const [toastVisible, setToastVisible] = useState(false);

  function toast(msg: string, type: 'ok' | 'err' | 'info' = 'info') {
    setToastMsg(msg);
    setToastType(type);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3500);
  }

  const { data: statusData, refetch: refetchStatus } = useQuery<BankStatus>({
    queryKey: ['bank-status'],
    queryFn: () => api.get('/bank-sync/status').then(r => r.data),
    staleTime: 30000,
  });

  const syncBankMut = useMutation({
    mutationFn: (bank: string) => api.post(`/bank-sync/${bank}/sync`, { days: 7 }).then(r => r.data as SyncResult),
    onSuccess: (d, bank) => {
      const n = d.count ?? 0;
      toast(`✓ ${bank.toUpperCase()}: ${n} ტრანზაქცია`, 'ok');
      setSyncResult(JSON.stringify(d, null, 2));
      qc.invalidateQueries({ queryKey: ['bank-status'] });
    },
    onError: () => toast('Sync ვერ მოხერხდა', 'err'),
  });

  const syncAllMut = useMutation({
    mutationFn: () => api.post('/bank-sync/sync-all', { days: 7 }).then(r => r.data as SyncResult),
    onSuccess: (d) => {
      toast(`✓ TBC:${d.tbc?.count ?? 0} BOG:${d.bog?.count ?? 0}`, 'ok');
      setSyncResult(JSON.stringify(d, null, 2));
      qc.invalidateQueries({ queryKey: ['bank-status'] });
    },
    onError: () => toast('Sync ვერ მოხერხდა', 'err'),
  });

  const banks = statusData?.banks ?? {};
  const tbc = banks.tbc ?? {};
  const bog = banks.bog ?? {};
  const tbcConn = tbc.connected || tbc.status === 'connected' || false;
  const bogConn = bog.connected || bog.status === 'connected' || false;
  const lastSync = tbc.last_sync || bog.last_sync;
  const queued = (tbc.queued_count ?? 0) + (bog.queued_count ?? 0);
  const syncing = syncBankMut.isPending || syncAllMut.isPending;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <div className="page__eyebrow">Operations · Bank Sync</div>
          <div className="page__title">Bank Sync <em>· direct</em></div>
          <div className="page__subtitle">TBC Bank, Bank of Georgia და Balance.ge ERP.</div>
        </div>
        <div className="bank-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => refetchStatus()}>↻ Status</button>
          <button className="btn btn-primary btn-sm" onClick={() => syncAllMut.mutate()} disabled={syncing}>
            {syncAllMut.isPending ? <><span className="spinner" /> Syncing…</> : '↻ Sync All'}
          </button>
        </div>
      </div>

      <div className="bank-kpi-grid">
        <div className="bank-kpi bank-kpi--blue">
          <div className="bank-kpi__label">TBC</div>
          <div className="bank-kpi__val">{tbcConn ? '✓ Live' : '⚠ Demo'}</div>
          <div className="bank-kpi__delta">connection</div>
        </div>
        <div className="bank-kpi bank-kpi--green">
          <div className="bank-kpi__label">BOG</div>
          <div className="bank-kpi__val">{bogConn ? '✓ Live' : '⚠ Demo'}</div>
          <div className="bank-kpi__delta">connection</div>
        </div>
        <div className="bank-kpi bank-kpi--amber">
          <div className="bank-kpi__label">Last Sync</div>
          <div className="bank-kpi__val bank-kpi__val--sm">{fmtDate(lastSync)}</div>
          <div className="bank-kpi__delta">timestamp</div>
        </div>
        <div className="bank-kpi bank-kpi--purple">
          <div className="bank-kpi__label">Queued</div>
          <div className="bank-kpi__val">{queued || '—'}</div>
          <div className="bank-kpi__delta">for review</div>
        </div>
      </div>

      <div className="bank-grid">
        <div className="card">
          <div className="bank-card-head">Bank Direct Sync</div>
          <div className="bank-card-body">
            <div className="recon-row">
              <div className="recon-left">
                <div className="recon-icon">T</div>
                <div>
                  <div className="recon-name">TBC Bank</div>
                  <div className="recon-sub">{tbc.message || tbc.mode || (tbcConn ? 'Connected' : 'DEMO mode')}</div>
                </div>
              </div>
              <div className="recon-right">
                <button className="btn btn-ghost btn-sm" onClick={() => syncBankMut.mutate('tbc')} disabled={syncing}>
                  {syncBankMut.isPending ? <span className="spinner" /> : '↻ TBC'}
                </button>
                <span className={`status-pill ${tbcConn ? 'sp-live' : 'sp-demo'}`}>{tbcConn ? 'LIVE' : 'DEMO'}</span>
              </div>
            </div>

            <div className="recon-row">
              <div className="recon-left">
                <div className="recon-icon">B</div>
                <div>
                  <div className="recon-name">Bank of Georgia</div>
                  <div className="recon-sub">{bog.message || bog.mode || (bogConn ? 'Connected' : 'DEMO mode')}</div>
                </div>
              </div>
              <div className="recon-right">
                <button className="btn btn-ghost btn-sm" onClick={() => syncBankMut.mutate('bog')} disabled={syncing}>
                  {syncBankMut.isPending ? <span className="spinner" /> : '↻ BOG'}
                </button>
                <span className={`status-pill ${bogConn ? 'sp-live' : 'sp-demo'}`}>{bogConn ? 'LIVE' : 'DEMO'}</span>
              </div>
            </div>

            <div className="recon-row recon-row--highlight">
              <div className="recon-left">
                <div className="recon-icon recon-icon--serif">β</div>
                <div>
                  <div className="recon-name">Balance.ge</div>
                  <div className="recon-sub">ERP · API Key ელოდება</div>
                </div>
              </div>
              <div className="recon-right">
                <a href="/app/settings" className="btn btn-ghost btn-sm">Setup</a>
                <span className="status-pill sp-demo">DEMO</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="bank-card-head">Sync შედეგი</div>
          <div className="bank-card-body">
            {syncResult ? (
              <pre className="sync-result-pre">{syncResult}</pre>
            ) : (
              <div className="empty-state">
                <div className="empty-ic">ƒ</div>
                <div className="empty-txt">Sync-ი ჯერ არ გაშვებულა</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toastVisible && (
        <div className={`a-toast a-toast--${toastType}`}>{toastMsg}</div>
      )}
    </div>
  );
}
