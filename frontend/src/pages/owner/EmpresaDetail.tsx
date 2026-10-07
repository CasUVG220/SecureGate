import { useEffect, useState } from 'react';
import { rellenar } from '../../components/charts/format';
import {
  getEmpresaStats, getSucursales, getUsuarios, createSucursal, deleteSucursal, assignAdminSucursal,
  type EmpresaStats, type Sucursal, type SucursalInput, type Usuario,
} from '../../services/api';
import { Skeleton, TableSkeleton } from '../../components/Skeleton';
import { Button, Input, Modal, ROW_ICON, RowActions, Select, StatusText, useConfirmacion } from '../../components/ui';
import TipoSucursalSelect from '../../components/TipoSucursalSelect';
import { etiquetaTipoSucursal } from '../../utils/sucursal';
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
  const { confirmar, dialogo } = useConfirmacion();

  const [stats, setStats]           = useState<EmpresaStats | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
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
    Promise.all([getEmpresaStats(empresaId), getSucursales(), getUsuarios()])
      .then(([s, all, usr]) => {
        setStats(s);
        setSucursales(all.filter(su => su.empresa_id === empresaId));
        setUsuarios(usr);
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
    const ok = await confirmar({
      title: rellenar(t('confirm.deleteBranch.title'), { nombre: suc.nombre }),
      message: t('confirm.deleteBranch.message'),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
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
    if (!adminTarget || !adminUserId.trim()) { setModalError(t('ae.selectUser')); return; }
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
        <div className="bg-danger-900/40 border border-danger-700 rounded-lg px-4 py-3 text-danger-300 text-sm">{error}</div>
      )}

      {loading ? <ResumenCifrasEsqueleto filas={3} /> : stats ? <ResumenEmpresa stats={stats} /> : null}

      {/* Tabla sucursales */}
      <div className="bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">{t('empDetail.branches')}</h2>
            <Button size="sm" onClick={openSucModal}>
              {t('empDetail.newBranch')}
            </Button>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar sucursal…"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-brand-500"
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
                    <td className="px-4 py-3 text-gray-400">{etiquetaTipoSucursal(t, suc.tipo)}</td>
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
      <Modal
        open={modal === 'sucursal'}
        onClose={closeModal}
        dismissible={!saving}
        title={t('empDetail.createBranch')}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-sucursal-detalle" loading={saving}>{t('empDetail.createBranch')}</Button>
          </>
        }
      >
        <form id="form-sucursal-detalle" onSubmit={handleCreateSucursal} className="space-y-4" noValidate>
          {modalError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{modalError}</p>}
          <Input name="nombre" label={t('common.name')} required autoFocus value={sucForm.nombre} onChange={handleSucChange} />
          <TipoSucursalSelect value={sucForm.tipo ?? ''} onChange={tipo => setSucForm(prev => ({ ...prev, tipo }))} />
          <Input name="direccion" label={t('empDetail.direction')} value={sucForm.direccion ?? ''} onChange={handleSucChange} />
        </form>
      </Modal>

      {/* Modal asignar admin: se elige a la persona de la lista, no se pega su identificador */}
      <Modal
        open={modal === 'admin'}
        onClose={closeModal}
        dismissible={!saving}
        size="sm"
        title={t('empDetail.assignAdmin')}
        description={adminTarget ? `${t('empDetail.branchLabel')} ${adminTarget.nombre}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" form="form-admin-detalle" loading={saving}>{t('empDetail.assign')}</Button>
          </>
        }
      >
        <form id="form-admin-detalle" onSubmit={handleAssignAdmin} className="space-y-4" noValidate>
          {modalError && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-400">{modalError}</p>}
          <Select label={t('ae.selectUser')} value={adminUserId} onChange={e => setAdminUserId(e.target.value)}>
            <option value="">{t('ae.selectUser')}</option>
            {usuarios.filter(u => u.activo && u.rol !== 'owner' && u.rol !== 'residente').map(u => (
              <option key={u.id} value={u.id}>{u.nombre} ({u.email})</option>
            ))}
          </Select>
        </form>
      </Modal>
      {dialogo}
    </div>
  );
}
