/**
 * Los handlers de Express 4 son `async` y, si uno lanza fuera de su propio
 * try/catch, la promesa rechazada NO llega al manejador de errores: queda como
 * `unhandledRejection`, que en Node ≥ 15 tumba el proceso (y la petición se
 * queda colgada). Un `residente_id` que no es UUID en POST /accesos, por
 * ejemplo, llegaba a `checkPreautorizacion` fuera del try/catch: un solo
 * request de cualquier agente bastaba para reiniciar el backend.
 *
 * Este parche (equivalente al paquete `express-async-errors`, sin dependencia
 * nueva) hace que toda promesa rechazada de un handler o middleware vaya a
 * `next(err)`, es decir, al manejador central de index.ts.
 *
 * Debe importarse ANTES de definir cualquier ruta.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require('express/lib/router/layer');

type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;

if (!Layer.prototype.__asyncErrorsParcheado) {
  Layer.prototype.handle_request = function handleRequest(
    this: { handle: Handler },
    req: unknown,
    res: unknown,
    next: (err?: unknown) => void,
  ) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // manejador de errores: no aplica
    try {
      const ret = fn(req, res, next) as Promise<unknown> | undefined;
      if (ret && typeof ret.catch === 'function') ret.catch(next);
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.__asyncErrorsParcheado = true;
}

export {};
