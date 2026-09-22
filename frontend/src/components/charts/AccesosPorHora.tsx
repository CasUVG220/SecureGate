import type { LangKey } from '../../context/LanguageContext';
import TimeSeriesChart from './TimeSeriesChart';
import { fmtNumero } from './format';

const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/**
 * Accesos de hoy, hora por hora. Las horas que todavía no llegan quedan en
 * cero: el gráfico se va llenando a lo largo del día, que es lo que se quiere
 * leer en una garita ("¿ya pasó la hora pico?").
 */
export default function AccesosPorHora({ porHora, lang, etiquetas, ariaLabel }: {
  porHora: number[];
  lang: LangKey;
  etiquetas: { serie: string; maximo: string; vacio: string };
  ariaLabel: string;
}) {
  return (
    <TimeSeriesChart
      variante="columnas"
      alto={150}
      datos={porHora.map((valor, h) => ({ fecha: String(h), valor }))}
      lang={lang}
      formatoValor={n => fmtNumero(n, lang)}
      etiquetas={{ actual: etiquetas.serie, maximo: etiquetas.maximo, vacio: etiquetas.vacio }}
      etiquetaX={i => String(i).padStart(2, '0')}
      etiquetaDetalle={i => `${hh(i)}–${hh(i + 1)}`}
      ariaLabel={ariaLabel}
    />
  );
}
