import { useEffect, useState } from 'react';
import {
  getEmpresaStats, getSucursales, createSucursal, deleteSucursal, assignAdminSucursal,
  type EmpresaStats, type Sucursal, type SucursalInput,
} from '../../services/api';
import { Skeleton, TableSkeleton } from '../../components/Skeleton';
import { Button, ROW_ICON, RowActions, StatusText } from '../../components/ui';
import { ResumenCifrasEsqueleto } from '../../components/charts';
import ResumenEmpresa from '../admin_empresa/ResumenEmpresa';
import { useToast } from '../../components/Toast';
import { useTranslation } from '../../i18n/useTranslation';

interface Props {
  empresaId: string;
  onBack: () => void;
}

const EMPTY_SUC: SucursalInput = { empresa_id: '', nombre: '', direccion: '', tipo: '' };

type Modal = 'none' | 'sucursal' | 'admin';

export default function EmpresaDetail({ empresaId, onBack }: Props) {
  const showToast = useToast();
  const { t } = useTranslation();

  const [stats, setStats]           = useState<EmpresaStats | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');

  const [modal, setModal]           = useState<Modal>('none');
  const [sucForm, setSucForm]       = useState<SucursalInput>({ ...EMPTY_SUC, empresa_id: empresaId });
  const [adminTarget, setAdminTarget] = useState<Sucursal | null>(null);
  const [adminUserId, setAdminUserId] = useState('');
  const [saving, setSaving]         = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    Promise.all([getEmpresaStats(empresaId), getSucursales()])
      .then(([s, all]) => {
        setStats(s);
        setSucursales(all.filter(su => su.empresa_id === empresaId));
      })
      .catch(() => setError(t('empDetail.noStats')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, [empresaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSucModal = () => {
    setSucForm({ ...EMPTY_SUC, empresa_id: empresaId });
    setModalError(null);
    setModal('sucursal');
  };

  const handleDeleteSucursal = async (suc: Sucursal) => {
    if (!window.confirm(`${t('ae.confirmDeleteSucursal')} "${suc.nombre}"?`)) return;
    try {
      await deleteSucursal(suc.id);
      cargar();
      showToast(t('ae.sucursalDeleted'), 'warning');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar sucursal', 'error');
    }
  };

  const openAdminModal = (suc: Sucursal) => {
    setAdminTarget(suc);
    setAdminUserId('');
    setModalError(null);
    setModal('admin');
  };

  const closeModal = () => {
    setModal('none');
    setAdminTarget(null);
    setModalError(null);
  };

  const handleSucChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setSucForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleCreateSucursal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sucForm.nombre.trim()) { setModalError('El nombre es requerido'); return; }
    setSaving(true); setModalError(null);
    try {
      await createSucursal({
        empresa_id: empresaId,
        nombre:     sucForm.nombre,
        direccion:  sucForm.direccion || undefined,
        tipo:       sucForm.tipo      || undefined,
      });
      closeModal();
      cargar();
      showToast(t('empDetail.branchCreated'));
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al crear sucursal');
    } finally {
      setSaving(false);
    }
  };

  const handleAssignAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminTarget || !adminUserId.trim()) { setModalError('ID de usuario requerido'); return; }
    setSaving(true); setModalError(null);
    try {
      await assignAdminSucursal(adminTarget.id, adminUserId.trim());
      closeModal();
      cargar();
      showToast(t('empDetail.adminAssigned'));
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al asignar admin');
    } finally {
      setSaving(false);
    }
  };

  const empresaNombre = sucursales[0]?.empresa_nombre ?? 'Empresa';

  return (
    <div className="sg-page text-gray-100">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-200 transition-colors"
          aria-label={t('common.back')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-white">
          {loading ? <Skeleton height="1.25rem" width="12rem" /> : empresaNombre}
        </h1>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {loading ? <ResumenCifrasEsqueleto filas={3} /> : stats ? <ResumenEmpresa stats={stats} /> : null}

      {/* Tabla sucursales */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">{t('empDetail.branches')}</h2>
            <Button size="sm" onClick={openSucModal} icon={<span className="text-base leading-none" aria-hidden="true">+</span>}>
              {t('empDetail.newBranch')}
            </Button>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar sucursal…"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">{t('empDetail.name')}</th>
                <th className="px-4 py-3 font-medium">{t('empDetail.tipo')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('empDetail.residents')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('empDetail.agents')}</th>
                <th className="px-4 py-3 font-medium text-center">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={3} cols={6} />
              ) : sucursales.filter(s => s.nombre.toLowerCase().includes(search.toLowerCase())).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    {t('empDetail.noBranches')}
                  </td>
                </tr>
              ) : (
                sucursales.filter(s => s.nombre.toLowerCase().includes(search.toLowerCase())).map(suc => (
                  <tr key={suc.id} className="border-b border-gray-700 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{suc.nombre}</p>
                      {suc.direccion && <p className="text-xs text-gray-500">{suc.direccion}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{suc.tipo ?? '—'}</td>
                    <td className="px-4 py-3 text-center">{suc.total_residentes}</td>
                    <td className="px-4 py-3 text-center">{suc.total_agentes}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusText kind={suc.activo ? 'on' : 'off'}>
                        {suc.activo ? t('common.activeF') : t('common.inactiveF')}
                      </StatusText>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        align="start"
                        menuLabel={`${t('common.actions')}: ${suc.nombre}`}
                        actions={[
                          {
                            id: 'admin',
                            label: t('empDetail.assignAdmin'),
                            icon: ROW_ICON.user,
                            tone: 'primary',
                            onClick: () => openAdminModal(suc),
                          },
                          {
                            id: 'eliminar',
                            label: t('common.delete'),
                            icon: ROW_ICON.trash,
                            tone: 'danger',
                            onClick: () => handleDeleteSucursal(suc),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal nueva sucursal */}
      {modal === 'sucursal' && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">{t('empDetail.createBranch')}</h2>
            {modalError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{modalError}</div>
            )}
            <form onSubmit={handleCreateSucursal} className="space-y-4">
              {([
                ['nombre',    `${t('common.name')} *`,  'text'],
                ['tipo',      t('empDetail.tipo'),       'text'],
                ['direccion', t('empDetail.direction'),  'text'],
              ] as [keyof SucursalInput, string, string][]).map(([name, label, type]) => (
                name !== 'empresa_id' && (
                  <div key={name}>
                    <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                    <input
                      name={name}
                      type={type}
                      value={(sucForm[name] as string) ?? ''}
                      onChange={handleSucChange}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )
              ))}
              <div className="flex gap-3 pt-2">
                <Button type="submit" loading={saving} className="flex-1">
                  {t('empDetail.createBranch')}
                </Button>
                <Button variant="ghost" onClick={closeModal}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal asignar admin */}
      {modal === 'admin' && adminTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">{t('empDetail.assignAdmin')}</h2>
            <p className="text-sm text-gray-400">{t('empDetail.branchLabel')} <span className="text-white font-medium">{adminTarget.nombre}</span></p>
            {modalError && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{modalError}</div>
            )}
            <form onSubmit={handleAssignAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('empDetail.userId')}</label>
                <input
                  type="text"
                  value={adminUserId}
                  onChange={e => setAdminUserId(e.target.value)}
                  placeholder={t('empDetail.userUuid')}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" loading={saving} className="flex-1">
                  {t('empDetail.assign')}
                </Button>
                <Button variant="ghost" onClick={closeModal}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
