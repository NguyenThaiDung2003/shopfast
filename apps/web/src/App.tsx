import { useEffect, useState } from 'react';

type ApiState = 'checking' | 'up' | 'down';

const STATE_LABEL: Record<ApiState, string> = {
  checking: 'Đang kiểm tra…',
  up: 'API hoạt động bình thường',
  down: 'Không kết nối được API',
};

export default function App() {
  const [apiState, setApiState] = useState<ApiState>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setApiState(res.ok ? 'up' : 'down'))
      .catch(() => setApiState('down'));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-bold text-slate-900">ShopFast</h1>
      <p className="text-slate-600">Sàn thương mại điện tử – giao diện demo.</p>
      <p
        className={
          apiState === 'up'
            ? 'text-green-700'
            : apiState === 'down'
              ? 'text-red-700'
              : 'text-slate-500'
        }
      >
        {STATE_LABEL[apiState]}
      </p>
    </main>
  );
}
