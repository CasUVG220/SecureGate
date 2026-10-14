/**
 * Validación del formulario de contacto en el navegador: las MISMAS reglas que el backend
 * (backend/src/routes/contacto.routes.ts), para que la persona vea el error junto al campo antes de enviar. El backend
 * vuelve a validar siempre; si discrepan, manda el backend y su 400 trae el error de cada campo.
 */
export interface DatosContacto {
  nombre: string;
  residencial: string;
  hogares: string;
  telefono: string;
  email: string;
  mensaje: string;
}

export type CampoContacto = keyof DatosContacto;
export type ErroresContacto = Partial<Record<CampoContacto, string>>;

const TRAMOS = ['50', '100', '200', '500', '1000', '1000+'];
// eslint-disable-next-line no-control-regex -- justo eso: rechazar caracteres de control, como el backend
const SIN_CONTROL_NI_ETIQUETAS = /^[^\u0000-\u001F\u007F<>]*$/u;
const CORREO = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const largo = (v: string, min: number, max: number) => {
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length >= min && t.length <= max && SIN_CONTROL_NI_ETIQUETAS.test(t);
};

export const telefonoValido = (v: string) => {
  const t = v.trim();
  if (!/^\+?[\d\s().-]+$/.test(t)) return false;
  const digitos = t.replace(/\D/g, '').length;
  return digitos >= 8 && digitos <= 15;
};

export function validarContacto(d: DatosContacto): ErroresContacto {
  const e: ErroresContacto = {};
  if (!largo(d.nombre, 2, 100)) e.nombre = 'Escribí tu nombre (de 2 a 100 caracteres).';
  if (!largo(d.residencial, 2, 150)) e.residencial = 'Escribí el nombre de la residencial (de 2 a 150 caracteres).';
  if (!TRAMOS.includes(d.hogares)) e.hogares = 'Elegí el número de hogares.';
  if (!telefonoValido(d.telefono)) e.telefono = 'Escribí un teléfono o WhatsApp de 8 a 15 dígitos.';
  if (!CORREO.test(d.email.trim()) || d.email.trim().length > 254) e.email = 'Escribí un correo válido.';
  if (d.mensaje.trim().length > 1000) e.mensaje = 'El mensaje admite hasta 1,000 caracteres.';
  return e;
}
