import { Select } from './ui';
import { useTranslation } from '../i18n/useTranslation';
import { esTipoConocido, TIPOS_SUCURSAL } from '../utils/sucursal';

interface Props {
  value: string;
  onChange: (valor: string) => void;
  name?: string;
}

/**
 * «Tipo» de la sucursal como lista de opciones (antes era texto libre y cada quien escribía lo suyo:
 * «Residencial», «residencial », «Colonia»…). Si la sucursal ya traía un tipo escrito a mano, se conserva como una
 * opción más para que editar la sucursal no lo borre sin querer.
 */
export default function TipoSucursalSelect({ value, onChange, name = 'tipo' }: Props) {
  const { t } = useTranslation();
  return (
    <Select name={name} label={t('empDetail.tipo')} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{t('sucursal.tipo.none')}</option>
      {TIPOS_SUCURSAL.map(tipo => <option key={tipo} value={tipo}>{t(`sucursal.tipo.${tipo}`)}</option>)}
      {value && !esTipoConocido(value) && <option value={value}>{value}</option>}
    </Select>
  );
}
