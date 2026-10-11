/**
 * Guarda de seguridad de las pruebas de integración: se niegan a correr si la
 * base no es local y descartable. Nunca contra la VM de GCP, Cloud SQL ni la
 * base de desarrollo (securegate).
 */
const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1', '[::1]'];

export const validarBaseDePrueba = (url: string | undefined): void => {
  if (!url) throw new Error('[guarda-bd] DATABASE_URL no está definida para las pruebas de integración.');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('[guarda-bd] DATABASE_URL no es una URL válida.');
  }
  if (!HOSTS_LOCALES.includes(u.hostname)) {
    throw new Error(`[guarda-bd] ABORTO: el host "${u.hostname}" no es local (localhost/127.0.0.1). Las pruebas solo corren contra una base descartable local.`);
  }
  const nombre = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!nombre.endsWith('_test')) {
    throw new Error(`[guarda-bd] ABORTO: la base "${nombre}" no termina en _test.`);
  }
};
