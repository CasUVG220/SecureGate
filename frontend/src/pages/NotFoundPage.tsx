interface Props {
  onNavigate: (page: string) => void;
  defaultPage: string;
}

export default function NotFoundPage({ onNavigate, defaultPage }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-gray-100">
      <p className="text-7xl font-bold text-gray-700">404</p>
      <p className="text-lg font-semibold text-white">Página no encontrada</p>
      <p className="text-sm text-gray-400">La sección que buscas no existe.</p>
      <button
        onClick={() => onNavigate(defaultPage)}
        className="mt-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-xl transition-colors text-sm"
      >
        Volver al inicio
      </button>
    </div>
  );
}
