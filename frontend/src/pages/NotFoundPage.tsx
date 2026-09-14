import { Button, ErrorState } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';

interface Props {
  onNavigate: (page: string) => void;
  defaultPage: string;
}

export default function NotFoundPage({ onNavigate, defaultPage }: Props) {
  const { t } = useTranslation();

  return (
    <div className="sg-page">
      <ErrorState
        variant="notFound"
        code="404"
        title={t('notFound.title')}
        description={t('notFound.desc')}
        action={<Button onClick={() => onNavigate(defaultPage)}>{t('notFound.back')}</Button>}
      />
    </div>
  );
}
