/**
 * Guía en pantalla para usar un celular como cámara (SCRUM-120). Texto claro, sin jerga: lo lee un agente de garita, no un técnico.
 * Qué se probó y con qué apps: docs/camaras_ip_diseno.md y docs/celular_como_camara.md.
 */
export function GuiaCelular() {
  return (
    <details className="rounded-lg border border-gray-600 p-3 text-sm text-gray-300" open>
      <summary className="cursor-pointer font-semibold text-gray-100">Cómo usar un celular como cámara</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5">
        <li><strong>Conecta el celular a la misma red Wi-Fi</strong> que esta computadora (la misma que usa la garita). Si el celular usa datos móviles o una red de invitados, no va a funcionar.</li>
        <li>Instala en el celular una aplicación que transmita video por la red. La probada es <strong>«IP Webcam»</strong> (Android). Ábrela y toca <strong>«Iniciar servidor»</strong>.</li>
        <li>La aplicación muestra una dirección parecida a <span className="font-mono">http://192.168.1.60:8080</span>. Escríbela aquí al final con <span className="font-mono">/video</span>, por ejemplo <span className="font-mono">http://192.168.1.60:8080/video</span>.</li>
        <li>Si en la aplicación pusiste usuario y contraseña, escríbelos en los campos de abajo.</li>
        <li>Pulsa <strong>«Probar conexión»</strong>: tiene que aparecer «Conexión correcta». Si falla, revisa que el celular siga con la pantalla encendida y en la misma red.</li>
      </ol>
      <p className="mt-3 text-xs text-gray-400">
        Consejos: deja el celular cargando y fijo frente al carril o al mostrador; pídele a quien administre la red que le reserve siempre la misma dirección (si cambia, la cámara dejará de verse y habrá que corregir la dirección aquí).
      </p>
    </details>
  );
}
