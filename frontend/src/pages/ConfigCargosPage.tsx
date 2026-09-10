import { useEffect, useState } from 'react';
import {
  getConfigCargos, createConfigCargo, updateConfigCargo, deleteConfigCargo,
  getCargosProgramados, createCargoProgramado, updateCargoProgramado,
  deleteCargoProgramado, aplicarCargoProgramado, getHistorialCargo,
  PeriodConflictError,
  decodeTokenPayload,
  type ConfigCargo,
  type CargoProgramado,
  type HistorialAplicacion,
} from '../services/api';
import { TableSkeleton, Spinner } from '../components/Skeleton';
import { ROW_ICON, RowActions, StatusText } from '../components/ui';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';
import ConfiguracionQrPage from './ConfiguracionQrPage';

const FRECUENCIAS = [
  { value: 'mensual',   label: 'Mensual (una vez por mes)' },
  { value: 'quincenal', label: 'Quincenal (cada 15 días)' },
  { value: 'unica_vez', label: 'Única vez (solo se cobra una vez)' },
] as const;

const FRECUENCIA_BADGE: Record<string, string> = {
  mensual:   'bg-blue-900/50 text-blue-400',
  quincenal: 'bg-amber-900/50 text-amber-400',
  unica_vez: 'bg-green-900/50 text-green-400',
};

const FRECUENCIA_LABEL: Record<string, string> = {
  mensual:   'Mensual',
  quincenal: 'Quincenal',
  unica_vez: 'Única vez',
};

const EMPTY_MORA_FORM = {
  nombre: '',
  monto: '',
  frecuencia: 'mensual' as 'mensual' | 'quincenal' | 'unica_vez',
  restringir_visitas_mora: false,
  costo_extra_visita_mora: '',
};
const EMPTY_PROG_FORM = { nombre: '', descripcion: '', monto: '', frecuencia: 'mensual' as 'mensual' | 'quincenal' | 'unica_vez' };

export default function ConfigCargosPage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const sucursalId = (() => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    return (decodeTokenPayload(token)?.sucursal_id as string) ?? null;
  })();

  const [activeTab, setActiveTab] = useState<'mora' | 'programados' | 'qr'>('mora');

  // ── Section A: Cargos por Mora ─────────────────────────────────────────
  const [configs, setConfigs]           = useState<ConfigCargo[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [showMoraModal, setShowMoraModal]   = useState(false);
  const [editMoraTarget, setEditMoraTarget] = useState<ConfigCargo | null>(null);
  const [moraForm, setMoraForm]         = useState(EMPTY_MORA_FORM);
  const [savingMora, setSavingMora]     = useState(false);
  const [moraFormError, setMoraFormError]   = useState<string | null>(null);
  const [togglingId, setTogglingId]     = useState<string | null>(null);

  // ── Section B: Cargos Programados ──────────────────────────────────────
  const [cargosProg, setCargosProg]     = useState<CargoProgramado[]>([]);
  const [loadingProg, setLoadingProg]   = useState(false);
  const [progLoaded, setProgLoaded]     = useState(false);
  const [progError, setProgError]       = useState<string | null>(null);

  const [showProgModal, setShowProgModal]   = useState(false);
  const [editProgTarget, setEditProgTarget] = useState<CargoProgramado | null>(null);
  const [progForm, setProgForm]         = useState(EMPTY_PROG_FORM);
  const [savingProg, setSavingProg]     = useState(false);
  const [progFormError, setProgFormError]   = useState<string | null>(null);

  const [confirmApply, setConfirmApply] = useState<CargoProgramado | null>(null);
  const [applying, setApplying]         = useState(false);

  const [historialModal, setHistorialModal] = useState<{
    cargo: CargoProgramado; entries: HistorialAplicacion[];
  } | null>(null);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  const loadMora = () => {
    setLoading(true);
    getConfigCargos()
      .then(setConfigs)
      .catch(() => setError('No se pudo cargar la configuración de cargos.'))
      .finally(() => setLoading(false));
  };

  const loadProg = () => {
    setLoadingProg(true);
    getCargosProgramados()
      .then(rows => { setCargosProg(rows); setProgLoaded(true); })
      .catch(() => setProgError('No se pudo cargar los cargos programados.'))
      .finally(() => setLoadingProg(false));
  };

  useEffect(() => { loadMora(); }, []);

  const handleTabChange = (tab: 'mora' | 'programados' | 'qr') => {
    setActiveTab(tab);
    if (tab === 'programados' && !progLoaded) loadProg();
  };

  // ── Mora handlers ──────────────────────────────────────────────────────

  const openMoraCreate = () => { setEditMoraTarget(null); setMoraForm(EMPTY_MORA_FORM); setMoraFormError(null); setShowMoraModal(true); };
  const openMoraEdit   = (cfg: ConfigCargo) => {
    setEditMoraTarget(cfg);
    setMoraForm({
      nombre: cfg.nombre,
      monto: cfg.monto,
      frecuencia: cfg.frecuencia ?? 'mensual',
      restringir_visitas_mora: cfg.restringir_visitas_mora ?? false,
      costo_extra_visita_mora: cfg.costo_extra_visita_mora != null ? String(parseFloat(cfg.costo_extra_visita_mora)) : '',
    });
    setMoraFormError(null);
    setShowMoraModal(true);
  };
  const closeMoraModal = () => { setShowMoraModal(false); setEditMoraTarget(null); };

  const handleMoraSave = async () => {
    if (!moraForm.nombre.trim()) { setMoraFormError('El nombre es requerido.'); return; }
    const monto = parseFloat(moraForm.monto);
    if (!moraForm.monto || isNaN(monto) || monto < 1) { setMoraFormError('El monto debe ser mayor a 0.'); return; }
    setMoraFormError(null); setSavingMora(true);
    const restringir = moraForm.restringir_visitas_mora;
    const costoExtra = restringir ? (parseFloat(moraForm.costo_extra_visita_mora) || 0) : 0;
    try {
      if (editMoraTarget) {
        const updated = await updateConfigCargo(editMoraTarget.id, {
          nombre: moraForm.nombre.trim(), monto, frecuencia: moraForm.frecuencia,
          restringir_visitas_mora: restringir, costo_extra_visita_mora: costoExtra,
        });
        setConfigs(prev => prev.map(c => c.id === updated.id ? updated : c));
        showToast(t('config.updated'));
      } else {
        const created = await createConfigCargo({
          nombre: moraForm.nombre.trim(), monto, frecuencia: moraForm.frecuencia,
          restringir_visitas_mora: restringir, costo_extra_visita_mora: costoExtra,
          sucursal_id: sucursalId ?? undefined,
        });
        setConfigs(prev => [...prev, created]);
        showToast(t('config.created'));
      }
      closeMoraModal();
    } catch (err: unknown) {
      setMoraFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingMora(false);
    }
  };

  const handleMoraToggle = async (cfg: ConfigCargo) => {
    setTogglingId(cfg.id);
    try {
      const updated = await updateConfigCargo(cfg.id, { activo: !cfg.activo });
      setConfigs(prev => prev.map(c => c.id === updated.id ? updated : c));
      showToast(updated.activo ? t('config.activated') : t('config.deactivated'), updated.activo ? 'success' : 'warning');
    } catch {
      showToast(t('config.cannotChange'), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleMoraDelete = async (cfg: ConfigCargo) => {
    if (!window.confirm(`${t('config.confirmDeactivate')} "${cfg.nombre}"?`)) return;
    try {
      await deleteConfigCargo(cfg.id);
      setConfigs(prev => prev.map(c => c.id === cfg.id ? { ...c, activo: false } : c));
      showToast(t('config.deactivated'), 'warning');
    } catch {
      showToast('No se pudo eliminar la configuración.', 'error');
    }
  };

  // ── Programados handlers ───────────────────────────────────────────────

  const openProgCreate = () => { setEditProgTarget(null); setProgForm(EMPTY_PROG_FORM); setProgFormError(null); setShowProgModal(true); };
  const openProgEdit   = (cp: CargoProgramado) => {
    setEditProgTarget(cp);
    setProgForm({ nombre: cp.nombre, descripcion: cp.descripcion ?? '', monto: cp.monto, frecuencia: cp.frecuencia });
    setProgFormError(null);
    setShowProgModal(true);
  };
  const closeProgModal = () => { setShowProgModal(false); setEditProgTarget(null); };

  const handleProgSave = async () => {
    if (!progForm.nombre.trim()) { setProgFormError('El nombre es requerido.'); return; }
    const monto = parseFloat(progForm.monto);
    if (!progForm.monto || isNaN(monto) || monto < 1) { setProgFormError('El monto debe ser mayor a 0.'); return; }
    setProgFormError(null); setSavingProg(true);
    try {
      if (editProgTarget) {
        const updated = await updateCargoProgramado(editProgTarget.id, {
          nombre:      progForm.nombre.trim(),
          descripcion: progForm.descripcion.trim() || undefined,
          monto,
          frecuencia:  progForm.frecuencia,
        });
        setCargosProg(prev => prev.map(c => c.id === updated.id
          ? { ...updated, veces_aplicado: c.veces_aplicado, residentes_afectados: c.residentes_afectados }
          : c));
        showToast('Cargo actualizado');
      } else {
        const created = await createCargoProgramado({
          nombre:      progForm.nombre.trim(),
          descripcion: progForm.descripcion.trim() || undefined,
          monto,
          frecuencia:  progForm.frecuencia,
        });
        setCargosProg(prev => [...prev, created]);
        showToast('Cargo creado');
      }
      closeProgModal();
    } catch (err: unknown) {
      setProgFormError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingProg(false);
    }
  };

  const handleAplicar = async () => {
    if (!confirmApply) return;
    setApplying(true);
    try {
      const result = await aplicarCargoProgramado(confirmApply.id);
      setCargosProg(prev => prev.map(c => c.id === confirmApply.id
        ? { ...c, ultimo_aplicado: new Date().toISOString(), veces_aplicado: c.veces_aplicado + 1 }
        : c));
      showToast(`Cargo aplicado a ${result.aplicado_a} residentes — Total: Q${result.monto_total}`, 'success');
      setConfirmApply(null);
    } catch (err: unknown) {
      if (err instanceof PeriodConflictError) {
        showToast(err.message, 'warning');
      } else {
        showToast(err instanceof Error ? err.message : 'Error al aplicar cargo', 'error');
      }
      setConfirmApply(null);
    } finally {
      setApplying(false);
    }
  };

  const handleProgToggle = async (cp: CargoProgramado) => {
    try {
      const updated = await updateCargoProgramado(cp.id, { activo: !cp.activo });
      setCargosProg(prev => prev.map(c => c.id === updated.id
        ? { ...updated, veces_aplicado: c.veces_aplicado, residentes_afectados: c.residentes_afectados }
        : c));
      showToast(updated.activo ? 'Cargo activado' : 'Cargo desactivado', updated.activo ? 'success' : 'warning');
    } catch {
      showToast('No se pudo cambiar el estado.', 'error');
    }
  };

  const handleProgDelete = async (cp: CargoProgramado) => {
    if (!window.confirm(`¿Eliminar el cargo "${cp.nombre}"?`)) return;
    try {
      await deleteCargoProgramado(cp.id);
      setCargosProg(prev => prev.map(c => c.id === cp.id ? { ...c, activo: false } : c));
      showToast('Cargo eliminado', 'warning');
    } catch {
      showToast('No se pudo eliminar el cargo.', 'error');
    }
  };

  const openHistorial = async (cp: CargoProgramado) => {
    setHistorialModal({ cargo: cp, entries: [] });
    setLoadingHistorial(true);
    try {
      const entries = await getHistorialCargo(cp.id);
      setHistorialModal({ cargo: cp, entries });
    } catch {
      showToast('No se pudo cargar el historial.', 'error');
      setHistorialModal(null);
    } finally {
      setLoadingHistorial(false);
    }
  };

  return (
    <div className="sg-page text-gray-100">

      {/* ── Mora modal ────────────────────────────────────────────────────── */}
      {showMoraModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">
                {editMoraTarget ? t('config.editTitle') : t('config.createTitle')}
              </h3>
              <button onClick={closeMoraModal} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            {moraFormError && <p className="text-sm text-red-400">{moraFormError}</p>}
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('config.nameLabel')} *</label>
              <input type="text" value={moraForm.nombre}
                onChange={e => setMoraForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder={t('config.namePlaceholder')}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Frecuencia de cobro</label>
              <select value={moraForm.frecuencia}
                onChange={e => setMoraForm(p => ({ ...p, frecuencia: e.target.value as 'mensual' | 'quincenal' | 'unica_vez' }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors">
                {FRECUENCIAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('config.amountLabel')} *</label>
              <input type="number" min="1" step="0.01" value={moraForm.monto}
                onChange={e => setMoraForm(p => ({ ...p, monto: e.target.value }))}
                placeholder={t('config.amountPlaceholder')}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>

            {/* Restringir visitas en mora */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <label className="text-sm text-gray-300">{t('config.restrictVisits')}</label>
              <button
                type="button"
                role="switch"
                aria-checked={moraForm.restringir_visitas_mora}
                onClick={() => setMoraForm(p => ({ ...p, restringir_visitas_mora: !p.restringir_visitas_mora }))}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  moraForm.restringir_visitas_mora ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  moraForm.restringir_visitas_mora ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {/* Costo extra por visita — habilitado solo si el toggle está activo */}
            <div>
              <label className={`block text-sm mb-1 ${moraForm.restringir_visitas_mora ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('config.extraCharge')}
              </label>
              <input type="number" min="0" step="0.01"
                value={moraForm.costo_extra_visita_mora}
                disabled={!moraForm.restringir_visitas_mora}
                onChange={e => setMoraForm(p => ({ ...p, costo_extra_visita_mora: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" />
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={handleMoraSave} disabled={savingMora}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-2">
                {savingMora && <Spinner />}
                {savingMora ? t('common.saving') : t('common.save')}
              </button>
              <button onClick={closeMoraModal} className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-4 py-2 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Programados create/edit modal ─────────────────────────────────── */}
      {showProgModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">
                {editProgTarget ? 'Editar cargo programado' : 'Nuevo cargo programado'}
              </h3>
              <button onClick={closeProgModal} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            {progFormError && <p className="text-sm text-red-400">{progFormError}</p>}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Nombre *</label>
              <input type="text" value={progForm.nombre}
                onChange={e => setProgForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder="Ej: Cuota de seguridad — Mayo 2026"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Descripción <span className="text-gray-500 font-normal">(opcional)</span>
              </label>
              <input type="text" value={progForm.descripcion}
                onChange={e => setProgForm(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Descripción del cargo"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Frecuencia</label>
              <select value={progForm.frecuencia}
                onChange={e => setProgForm(p => ({ ...p, frecuencia: e.target.value as 'mensual' | 'quincenal' | 'unica_vez' }))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors">
                {FRECUENCIAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Monto (Q) *</label>
              <input type="number" min="1" step="0.01" value={progForm.monto}
                onChange={e => setProgForm(p => ({ ...p, monto: e.target.value }))}
                placeholder="850.00"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={handleProgSave} disabled={savingProg}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-2">
                {savingProg && <Spinner />}
                {savingProg ? t('common.saving') : t('common.save')}
              </button>
              <button onClick={closeProgModal} className="bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-4 py-2 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm apply modal ───────────────────────────────────────────── */}
      {confirmApply && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="text-white font-semibold">Confirmar aplicación</h3>
            <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-3 space-y-1.5">
              <p className="text-amber-200 text-sm font-medium">
                ¿Aplicar Q{parseFloat(confirmApply.monto).toFixed(2)} a todos los residentes activos?
              </p>
              <p className="text-amber-300/80 text-xs">
                Esto sumará Q{parseFloat(confirmApply.monto).toFixed(2)} al saldo pendiente de cada residente y cambiará su estado a mora.
              </p>
            </div>
            <p className="text-gray-400 text-xs">
              <span className="font-medium text-gray-300">{confirmApply.nombre}</span>
              <span className="mx-1.5">·</span>
              {FRECUENCIA_LABEL[confirmApply.frecuencia] ?? confirmApply.frecuencia}
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={handleAplicar} disabled={applying}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors flex items-center justify-center gap-2">
                {applying && <Spinner />}
                {applying ? 'Aplicando...' : 'Confirmar'}
              </button>
              <button onClick={() => setConfirmApply(null)} disabled={applying}
                className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 font-medium px-4 py-2 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Historial modal ───────────────────────────────────────────────── */}
      {historialModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col space-y-4">
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-white font-semibold">Historial de aplicaciones</h3>
                <p className="text-gray-400 text-xs mt-0.5">{historialModal.cargo.nombre}</p>
              </div>
              <button onClick={() => setHistorialModal(null)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {loadingHistorial ? (
                <div className="flex items-center justify-center py-8"><Spinner size={24} /></div>
              ) : historialModal.entries.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">
                  Este cargo no ha sido aplicado aún.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-left text-xs">
                      <th className="pb-2 font-medium">Fecha</th>
                      <th className="pb-2 font-medium text-center">Residentes</th>
                      <th className="pb-2 font-medium">Total cobrado</th>
                      <th className="pb-2 font-medium">Aplicado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historialModal.entries.map((h, i) => (
                      <tr key={i} className="border-b border-gray-700/50 last:border-0">
                        <td className="py-2.5 text-gray-200 text-xs">
                          {new Date(h.applied_at).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 text-white font-medium text-xs text-center">{h.residentes}</td>
                        <td className="py-2.5 text-emerald-400 font-semibold text-xs">
                          Q{parseFloat(h.monto_total).toFixed(2)}
                        </td>
                        <td className="py-2.5 text-gray-300 text-xs">{h.aplicado_por_nombre}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="sg-panel-heading">
        <div>
          <p className="sg-eyebrow">SecureGate · Reglas locales</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t('config.title')}</h1>
          <p className="mt-1 text-sm text-[var(--sg-text-muted)]">Define cómo tu comunidad gestiona mora, cargos programados y accesos QR.</p>
        </div>
        <span className="sg-status bg-emerald-500/10 text-emerald-400">Configuración activa</span>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="sg-tabbar max-w-2xl">
        <button
          onClick={() => handleTabChange('mora')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'mora' ? 'sg-tab-active bg-[color-mix(in_srgb,var(--sg-primary)_12%,transparent)]' : 'sg-tab hover:bg-white/5'
          }`}
        >
          Cargos por Mora
        </button>
        <button
          onClick={() => handleTabChange('programados')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'programados' ? 'sg-tab-active bg-[color-mix(in_srgb,var(--sg-primary)_12%,transparent)]' : 'sg-tab hover:bg-white/5'
          }`}
        >
          Cargos Programados
        </button>
        <button
          onClick={() => handleTabChange('qr')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'qr' ? 'sg-tab-active bg-[color-mix(in_srgb,var(--sg-primary)_12%,transparent)]' : 'sg-tab hover:bg-white/5'
          }`}
        >
          {t('qr.configTabLabel')}
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════
          SECTION A — Cargos por Mora
      ════════════════════════════════════════════════════════════ */}
      {activeTab === 'mora' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">{t('config.subtitle')}</h2>
              <p className="text-xs text-gray-400 mt-0.5">Se aplican automáticamente al registrar acceso con mora</p>
              <p className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                {t('config.autoChargeNote')}
              </p>
            </div>
            <button onClick={openMoraCreate}
              className="sg-btn sg-btn-primary text-sm">
              {t('config.new')}
            </button>
          </div>

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
          )}

          <div className="sg-card overflow-hidden max-w-3xl">
            {!loading && configs.length === 0 ? (
              <p className="text-gray-400 text-sm px-6 py-8 text-center">{t('config.noConfigs')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-left">
                    <th className="px-5 py-3 font-medium">{t('common.name')}</th>
                    <th className="px-5 py-3 font-medium">Frecuencia</th>
                    <th className="px-5 py-3 font-medium">{t('common.amount')}</th>
                    <th className="px-5 py-3 font-medium">{t('common.status')}</th>
                    <th className="px-5 py-3 font-medium text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableSkeleton rows={4} cols={5} />
                  ) : (
                    configs.map((cfg, i) => (
                      <tr key={cfg.id} className={`border-b border-gray-700/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-700/20'}`}>
                        <td className="px-5 py-3 text-white font-medium">{cfg.nombre}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${FRECUENCIA_BADGE[cfg.frecuencia] ?? 'bg-gray-700 text-gray-300'}`}>
                            {FRECUENCIA_LABEL[cfg.frecuencia] ?? cfg.frecuencia}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-200">Q{parseFloat(cfg.monto).toFixed(2)}</td>
                        <td className="px-5 py-3">
                          <StatusText kind={cfg.activo ? 'on' : 'off'}>
                            {cfg.activo ? t('common.active') : t('common.inactive')}
                          </StatusText>
                        </td>
                        <td className="px-5 py-3">
                          <RowActions
                            menuLabel={`${t('common.actions')}: ${cfg.nombre}`}
                            actions={[
                              { id: 'editar', label: t('common.edit'), icon: ROW_ICON.edit, tone: 'primary', onClick: () => openMoraEdit(cfg) },
                              {
                                id: 'toggle',
                                label: cfg.activo ? t('common.deactivate') : t('common.activate'),
                                icon: cfg.activo ? ROW_ICON.pause : ROW_ICON.play,
                                loading: togglingId === cfg.id,
                                onClick: () => handleMoraToggle(cfg),
                              },
                              ...(cfg.activo
                                ? [{ id: 'eliminar', label: t('common.delete'), icon: ROW_ICON.trash, tone: 'danger' as const, onClick: () => handleMoraDelete(cfg) }]
                                : []),
                            ]}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          SECTION B — Cargos Programados
      ════════════════════════════════════════════════════════════ */}
      {activeTab === 'programados' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Cargos Programados</h2>
              <p className="text-xs text-gray-400 mt-0.5">Aplica cargos manuales a todos los residentes de la sucursal</p>
            </div>
            <button onClick={openProgCreate}
              className="sg-btn sg-btn-primary text-sm">
              + Nuevo cargo programado
            </button>
          </div>

          {progError && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{progError}</div>
          )}

          <div className="sg-card overflow-hidden">
            {loadingProg ? (
              <table className="w-full text-sm">
                <tbody><TableSkeleton rows={3} cols={6} /></tbody>
              </table>
            ) : cargosProg.length === 0 ? (
              <p className="text-gray-400 text-sm px-6 py-8 text-center">
                No hay cargos programados. Crea uno con el botón de arriba.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-left">
                      <th className="px-5 py-3 font-medium">Nombre</th>
                      <th className="px-5 py-3 font-medium">Monto</th>
                      <th className="px-5 py-3 font-medium">Frecuencia</th>
                      <th className="px-5 py-3 font-medium">Último aplicado</th>
                      <th className="px-5 py-3 font-medium text-center">Aplicaciones</th>
                      <th className="px-5 py-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cargosProg.map((cp, i) => (
                      <tr key={cp.id} className={`border-b border-gray-700/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-700/20'}`}>
                        <td className="px-5 py-3">
                          <p className={`font-medium ${cp.activo ? 'text-white' : 'text-gray-500 line-through'}`}>{cp.nombre}</p>
                          {cp.descripcion && <p className="text-gray-500 text-xs mt-0.5 truncate max-w-[200px]">{cp.descripcion}</p>}
                        </td>
                        <td className="px-5 py-3 text-gray-200 font-medium">Q{parseFloat(cp.monto).toFixed(2)}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${FRECUENCIA_BADGE[cp.frecuencia] ?? 'bg-gray-700 text-gray-300'}`}>
                            {FRECUENCIA_LABEL[cp.frecuencia] ?? cp.frecuencia}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs">
                          {cp.ultimo_aplicado
                            ? <span className="text-gray-300">{new Date(cp.ultimo_aplicado).toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                            : <span className="text-gray-600">Nunca</span>}
                        </td>
                        <td className="px-5 py-3 text-center text-gray-300 text-xs">
                          {cp.veces_aplicado ?? 0}
                        </td>
                        <td className="px-5 py-3">
                          <RowActions
                            menuLabel={`${t('common.actions')}: ${cp.nombre}`}
                            actions={[
                              ...(cp.activo
                                ? [{ id: 'aplicar', label: 'Aplicar ahora', icon: ROW_ICON.check, tone: 'primary' as const, onClick: () => setConfirmApply(cp) }]
                                : []),
                              { id: 'historial', label: 'Historial', icon: ROW_ICON.history, onClick: () => openHistorial(cp) },
                              { id: 'editar', label: t('common.edit'), icon: ROW_ICON.edit, onClick: () => openProgEdit(cp) },
                              {
                                id: 'toggle',
                                label: cp.activo ? t('common.deactivate') : t('common.activate'),
                                icon: cp.activo ? ROW_ICON.pause : ROW_ICON.play,
                                onClick: () => handleProgToggle(cp),
                              },
                              ...(cp.activo
                                ? [{ id: 'eliminar', label: t('common.delete'), icon: ROW_ICON.trash, tone: 'danger' as const, onClick: () => handleProgDelete(cp) }]
                                : []),
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          SECTION C — Reglas de uso del QR
      ════════════════════════════════════════════════════════════ */}
      {activeTab === 'qr' && <ConfiguracionQrPage />}
    </div>
  );
}
