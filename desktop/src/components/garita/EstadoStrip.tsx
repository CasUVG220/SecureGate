/**
 * Tira de estado de la garita: conexión, frescura de los datos locales, cola
 * pendiente, licencia y OCR. Lo que el agente necesita para saber qué tan
 * confiable es lo que ve mientras está offline.
 *
 * No usa los resúmenes de cifras de la web (pensados para números grandes
 * en los paneles de administración); aquí los valores son texto corto y lo que
 * importa es el estado, que se lee con el mismo StatusText de las tablas.
 */
import { useEffect, useState } from 'react';
import { StatusText, cx, type StatusKind } from '../ui';
import { haceCuanto, horasATexto } from '../../lib/tiempo';
import type { EstadoApp } from '../../lib/tauri';

function Item({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0 px-5 py-3', className)}>
      <p className="mb-1 truncate text-2xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="truncate text-sm font-medium text-gray-100">{children}</div>
    </div>
  );
}

export function EstadoStrip({ estado }: { estado: EstadoApp }) {
  // Re-render cada 30 s para que "hace X min" no se quede viejo.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick(n => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const { sync, licencia, ocr } = estado;
  const licKind: StatusKind = licencia.estado === 'activa' ? 'on' : licencia.estado === 'en_gracia' ? 'warn' : 'bad';
  const licTexto =
    licencia.estado === 'activa' ? 'Activa'
    : licencia.estado === 'en_gracia' ? `Sin servidor · ${horasATexto(licencia.horas_restantes)} restantes`
    : licencia.estado === 'bloqueada' ? 'Bloqueada'
    : 'Sin licencia';

  return (
    <section aria-label="Estado de la garita" className="sg-card grid grid-cols-2 divide-x divide-gray-700 lg:grid-cols-5">
      <Item label="Conexión">
        <StatusText kind={sync.en_linea ? 'on' : 'warn'} className="text-sm">{sync.en_linea ? 'En línea' : 'Sin conexión'}</StatusText>
      </Item>
      <Item label="Datos locales">
        <span title={sync.ultima_sync_ok ?? ''}>
          {sync.ultima_sync_ok ? `Actualizados ${haceCuanto(sync.ultima_sync_ok)}` : 'Sin sincronizar'}
        </span>
      </Item>
      <Item label="Por sincronizar">
        {sync.pendientes === 0
          ? <StatusText kind="on" className="text-sm">Todo enviado</StatusText>
          : <StatusText kind="warn" className="text-sm">{sync.pendientes} acceso{sync.pendientes === 1 ? '' : 's'}{sync.sincronizando ? ' · enviando…' : ''}</StatusText>}
        {sync.rechazados > 0 && (
          <StatusText kind="bad" className="ml-2 text-sm">{sync.rechazados} rechazado{sync.rechazados === 1 ? '' : 's'}</StatusText>
        )}
      </Item>
      <Item label="Licencia">
        <StatusText kind={licKind} className="text-sm">{licTexto}</StatusText>
      </Item>
      <Item label="OCR local" className="col-span-2 lg:col-span-1">
        {ocr.disponible
          ? <StatusText kind="on" className="text-sm">Listo{ocr.ms_carga != null ? ` · cargó en ${ocr.ms_carga} ms` : ''}</StatusText>
          : <StatusText kind={ocr.error ? 'bad' : 'off'} className="text-sm">{ocr.error ? 'No disponible' : 'Cargando…'}</StatusText>}
      </Item>
    </section>
  );
}
