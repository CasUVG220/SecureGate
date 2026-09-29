import { useEffect, useState } from 'react';
import { getUsuarios, createUsuario, type Usuario } from '../services/api';
import { TableSkeleton, Spinner } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useTranslation } from '../i18n/useTranslation';
import { StatusText } from '../components/ui';

const EMPTY_AGENT = { nombre: '', email: '', password: '' };

export default function AgentesPage() {
  const showToast = useToast();
  const { t } = useTranslation();

  const [agentes, setAgentes] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [agentForm, setAgentForm] = useState(EMPTY_AGENT);
  const [saving, setSaving] = useState(false);

  const cargar = () => {
    setLoading(true);
    getUsuarios()
      .then(data => {
        // Filter out any non-agente/non-admin roles if desired, 
        // though backend getUsuarios already excludes residentes.
        setAgentes(data);
      })
      .catch(() => setError('No se pudo cargar la lista de personal.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleAgentChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setAgentForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const cancelForm = () => {
    setShowForm(false);
    setAgentForm(EMPTY_AGENT);
    setError(null);
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createUsuario({ 
        nombre: agentForm.nombre, 
        email: agentForm.email, 
        password: agentForm.password, 
        rol: 'agente' 
      });
      cancelForm();
      cargar();
      showToast(t('residents.agentCreated') || 'Agente creado');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al crear agente');
    } finally {
      setSaving(false);
    }
  };

  const filtered = agentes.filter(a => {
    const q = search.toLowerCase();
    return (`${a.nombre} ${a.email} ${a.rol}`).toLowerCase().includes(q);
  });

  return (
    <div className="sg-page text-gray-100">
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      <div className="sg-panel-heading">
        <div>
          <p className="sg-eyebrow">SecureGate · Personal operativo</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">Personal y agentes</h1>
          <p className="mt-1 text-sm text-gray-400">Gestiona quién está listo para proteger la operación de tu comunidad.</p>
        </div>
        {!loading && <span className="sg-status bg-emerald-500/10 text-emerald-400">{filtered.length} registrados</span>}
      </div>

      {/* Create agent form */}
      {showForm && (
        <form onSubmit={handleCreateAgent} className="sg-card space-y-4 p-5 sm:p-7">
          <h2 className="font-bold text-white text-lg">{t('residents.createAgentTitle') || 'Nuevo Agente'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([
              ['nombre',   t('common.name'),     'text',     true],
              ['email',    t('common.email'),    'email',    true],
              ['password', t('common.password'), 'password', true],
            ] as [keyof typeof EMPTY_AGENT, string, string, boolean][]).map(([name, label, type, req]) => (
              <div key={name}>
                <label className="block text-sm text-gray-300 mb-1">{label}{req && ' *'}</label>
                <input name={name} type={type} value={agentForm[name]} onChange={handleAgentChange} required={req}
                  minLength={name === 'password' ? 8 : undefined}
                  autoComplete={name === 'password' ? 'new-password' : undefined}
                  className="sg-input" />
                {name === 'password' && (
                  <p className="mt-1 text-xs text-gray-400">{t('inv.accept.passwordHint')}</p>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="sg-btn sg-btn-primary flex items-center gap-2">
              {saving && <Spinner />}
              {saving ? t('common.saving') : t('common.create')}
            </button>
            <button type="button" onClick={cancelForm} className="text-gray-400 hover:text-gray-200 px-4 py-2 rounded-xl transition-colors">{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {/* Action bar */}
      {!showForm && (
        <div className="sg-card space-y-3 p-5 sm:p-6">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold text-white">
              Personal / Agentes
              {!loading && <span className="ml-2 text-sm font-normal text-gray-400">({filtered.length})</span>}
            </h1>
            <button onClick={() => { setShowForm(true); setError(null); }}
              className="sg-btn sg-btn-primary text-sm">
              {t('residents.newAgent') || 'Nuevo Agente'}
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o rol…"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      )}

      {/* Table */}
      <div className="sg-table-wrap overflow-hidden">
        {!loading && filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">No hay personal registrado</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-5 py-3 font-medium">{t('common.name')}</th>
                <th className="px-5 py-3 font-medium">{t('common.email')}</th>
                <th className="px-5 py-3 font-medium">Rol</th>
                <th className="px-5 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} cols={4} />
              ) : (
                filtered.map((a, i) => (
                  <tr key={a.id} className={`border-b border-gray-700 last:border-0 ${i % 2 === 1 ? 'bg-gray-700/20' : ''}`}>
                    <td className="px-5 py-3 font-semibold text-white">{a.nombre}</td>
                    <td className="px-5 py-3 text-gray-400">{a.email}</td>
                    <td className="px-5 py-3 text-gray-200 capitalize">{a.rol.replace('_', ' ')}</td>
                    <td className="px-5 py-3">
                      <StatusText kind={a.activo ? 'on' : 'off'}>
                        {a.activo ? 'Activo' : 'Inactivo'}
                      </StatusText>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
