/**
 * Puente tipado hacia los comandos Rust. Es el ÚNICO lugar del frontend que
 * llama a `invoke`; el resto de la app trabaja con estas funciones y tipos.
 *
 * Nada de tokens aquí: el JWT y la licencia viven en Rust (almacén seguro).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ── Tipos (espejo de los DTO de src-tauri/src/*.rs) ─────────────────────────

export type EstadoLicencia =
  | { estado: 'sin_licencia' }
  | { estado: 'activa' }
  | { estado: 'en_gracia'; horas_restantes: number }
  | { estado: 'bloqueada'; motivo: string };

export type LicenciaDto = EstadoLicencia & {
  sucursal_nombre: string | null;
  sucursal_id: string | null;
  ultimo_heartbeat_ok: string | null;
  heartbeat_intervalo_min: number | null;
  gracia_horas: number | null;
  fingerprint: string;
};

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

export interface SesionDto {
  usuario: Usuario | null;
  requiere_login: boolean;
  iniciada_en: string | null;
}

export interface EstadoSync {
  en_linea: boolean;
  ultima_sync_ok: string | null;
  ultimo_push_ok: string | null;
  pendientes: number;
  rechazados: number;
  ultimo_error: string | null;
  sincronizando: boolean;
}

export interface EstadoOcr {
  disponible: boolean;
  ms_carga: number | null;
  error: string | null;
}

// ── Hardware de talanquera (ver src-tauri/src/hardware/mod.rs) ──────────────

export type ProtocoloSerial = 'lcus' | 'ascii' | 'personalizado';
export type ModoTcp = 'tcp' | 'http';
export type MetodoHttp = 'get' | 'post';

export interface ConfigSerial {
  puerto: string | null;
  baudios: number;
  protocolo: ProtocoloSerial;
  canal: number;
  pulso_ms: number;
  comando_on_hex: string | null;
  comando_off_hex: string | null;
}

export interface ConfigTcp {
  host: string;
  puerto: number;
  modo: ModoTcp;
  comando: string;
  comando_off: string | null;
  pulso_ms: number;
  timeout_ms: number;
  metodo: MetodoHttp;
  ruta: string;
  ruta_off: string | null;
}

export interface ConfigGpio {
  pin: number;
  pulso_ms: number;
  activo_alto: boolean;
}

/** JSON etiquetado por `tipo`, igual que lo persiste Rust. */
export type ConfigHardware =
  | { tipo: 'ninguno' }
  | ({ tipo: 'serial_usb' } & ConfigSerial)
  | ({ tipo: 'ethernet' } & ConfigTcp)
  | ({ tipo: 'gpio' } & ConfigGpio);

export type EstadoConexion = 'conectado' | 'desconectado' | 'error' | 'sin_driver';

export interface EstadoHardware {
  nombre: string;
  estado: EstadoConexion;
  config: ConfigHardware;
}

export interface TalanqueraError {
  tipo: 'sin_driver' | 'no_disponible' | 'timeout' | 'envio' | 'config' | 'no_soportado';
  detalle?: string;
}

export interface ResultadoApertura {
  abierta: boolean;
  driver: string;
  error: TalanqueraError | null;
}

export interface PuertoSerial {
  nombre: string;
  vid: number | null;
  pid: number | null;
  fabricante: string | null;
  producto: string | null;
}

export interface EstadoApp {
  licencia: LicenciaDto;
  sesion: SesionDto;
  sync: EstadoSync;
  ocr: EstadoOcr;
  hardware: EstadoHardware;
  api_url: string;
  version: string;
}

export interface Residente {
  id: string;
  numero_casa: string;
  nombre: string;
  estado_pago: 'al_dia' | 'mora' | 'pendiente' | string;
  telefono: string | null;
}

export interface Preautorizacion {
  id: string;
  residente_id: string;
  nombre_visitante: string;
  numero_dpi: string | null;
  placa: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
}

export interface Evaluacion {
  bloqueado: boolean;
  razon_bloqueo: string | null;
  /** Qué coincidió con la lista negra: el DPI del visitante o la placa del vehículo. */
  motivo_bloqueo?: 'dpi' | 'placa' | null;
  preautorizado: boolean;
  preautorizacion: Preautorizacion | null;
  visitante_conocido: string | null;
}

export interface NuevoAcceso {
  nombre_visitante: string;
  numero_dpi: string;
  residente_id: string;
  placa: string | null;
  notas: string | null;
  capturado_manualmente: boolean;
  /** Invitación QR presentada por el visitante, si entró por ese camino. */
  invitacion_qr_id?: string | null;
}

/**
 * Acceso que sigue abierto (sin salida registrada) para una placa.
 * La forma es la que devuelve GET /accesos/activo, con visitante y residente
 * anidados.
 */
export interface AccesoActivo {
  registro_id: string;
  timestamp_entrada: string;
  visitante: { id: string; nombre: string; numero_dpi: string };
  residente: { id: string; numero_casa: string; nombre: string };
  placa: string | null;
}

/** Lo que devuelve el backend al verificar un QR vigente. */
export interface InvitacionQr {
  id: string;
  tipo: 'grupal' | 'individual';
  etiqueta: string | null;
  nombre_visitante: string | null;
  numero_dpi: string | null;
  placa: string | null;
  residente_id: string;
  numero_casa: string;
  residente_nombre: string;
  usos_maximos: number | null;
  usos_actuales: number;
}

export interface AccesoPendiente {
  id_cliente: string;
  registrado_en: string;
  estado: 'pendiente' | 'sincronizado' | 'rechazado';
  intentos: number;
  ultimo_error: string | null;
  sincronizado_en: string | null;
  nombre_visitante: string;
  numero_dpi: string;
  placa: string | null;
  residente_casa: string | null;
  capturado_manualmente: boolean;
}

export interface ItemOcr {
  texto: string;
  confianza: number;
}

export interface ResultadoOcr {
  texto: string;
  items: ItemOcr[];
  confianza: number;
  ms_inferencia: number;
  ms_total: number;
  ms_roundtrip: number;
}

export interface AppError {
  codigo: string;
  mensaje: string;
  status?: number;
}

export const esAppError = (e: unknown): e is AppError =>
  typeof e === 'object' && e !== null && 'codigo' in e && 'mensaje' in e;

export const mensajeDe = (e: unknown): string =>
  esAppError(e) ? e.mensaje : e instanceof Error ? e.message : String(e);

// ── Comandos ────────────────────────────────────────────────────────────────

export const api = {
  estado: () => invoke<EstadoApp>('app_estado'),
  configurarApiUrl: (apiUrl: string) => invoke<string>('app_configurar_api_url', { apiUrl }),

  licencia: {
    estado: () => invoke<LicenciaDto>('licencia_estado'),
    activar: (codigo: string, nombreDispositivo?: string) =>
      invoke<LicenciaDto>('licencia_activar', { codigo, nombreDispositivo: nombreDispositivo ?? null }),
    heartbeat: () => invoke<LicenciaDto>('licencia_heartbeat'),
    desvincular: () => invoke<void>('licencia_desvincular'),
  },

  sesion: {
    estado: () => invoke<SesionDto>('sesion_estado'),
    login: (email: string, password: string) => invoke<SesionDto>('sesion_login', { email, password }),
    logout: () => invoke<void>('sesion_logout'),
  },

  garita: {
    buscarResidentes: (q: string) => invoke<Residente[]>('garita_buscar_residentes', { q }),
    evaluarVisitante: (numeroDpi: string, placa?: string | null, residenteId?: string | null) =>
      invoke<Evaluacion>('garita_evaluar_visitante', {
        numeroDpi, placa: placa ?? null, residenteId: residenteId ?? null,
      }),
    registrarAcceso: (acceso: NuevoAcceso) =>
      invoke<{ acceso: AccesoPendiente; apertura: ResultadoApertura }>('garita_registrar_acceso', { acceso }),
    recientes: (limite = 30) => invoke<AccesoPendiente[]>('garita_accesos_recientes', { limite }),
    verificarQr: (id: string) => invoke<InvitacionQr>('garita_verificar_qr', { id }),
    buscarSalida: (placa: string) => invoke<AccesoActivo | null>('garita_buscar_salida', { placa }),
    registrarSalida: (registroId: string) =>
      invoke<{ registro: unknown; apertura: ResultadoApertura }>('garita_registrar_salida', { registroId }),
  },

  hardware: {
    estado: () => invoke<EstadoHardware>('hardware_estado'),
    puertos: () => invoke<PuertoSerial[]>('hardware_puertos'),
    configurar: (config: ConfigHardware) => invoke<EstadoHardware>('hardware_config_set', { config }),
    /** Sin `config` prueba el driver activo; con ella, uno temporal sin guardar. */
    probar: (config?: ConfigHardware) => invoke<ResultadoApertura>('hardware_probar', { config: config ?? null }),
    abrir: () => invoke<ResultadoApertura>('hardware_abrir'),
  },

  sync: {
    estado: () => invoke<EstadoSync>('sync_estado'),
    ahora: () => invoke<EstadoSync>('sync_ahora'),
  },

  ocr: {
    placa: (imagenBase64: string) => invoke<ResultadoOcr>('ocr_placa', { imagenBase64 }),
    precalentar: () => invoke<EstadoOcr>('ocr_precalentar'),
    estado: () => invoke<EstadoOcr>('ocr_estado'),
    dpiRemoto: (imagenBase64: string) =>
      invoke<{ nombre: string; numero_dpi: string; texto_completo: string }>('ocr_dpi_remoto', { imagenBase64 }),
  },
};

/** Rust emite este evento tras cada sync / heartbeat / push. */
export const onEstadoSync = (cb: (e: EstadoSync) => void): Promise<UnlistenFn> =>
  listen<EstadoSync>('sg://estado', ev => cb(ev.payload));
