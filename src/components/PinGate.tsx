import React, { useState } from 'react';

const PIN = import.meta.env.VITE_LKS_PIN as string | undefined;
const STORAGE_KEY = 'lkstv_pin_ok';

const PinGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (!PIN) return true;
    return localStorage.getItem(STORAGE_KEY) === PIN;
  });
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = () => {
    if (input === PIN) {
      localStorage.setItem(STORAGE_KEY, PIN);
      setUnlocked(true);
    } else {
      setError(true);
      setShake(true);
      setInput('');
      setTimeout(() => setShake(false), 600);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-zinc-950 z-50">
      <div
        className={`flex flex-col items-center gap-6 transition-transform ${shake ? 'animate-shake' : ''}`}
        style={shake ? { animation: 'shake 0.5s ease' } : {}}
      >
        <div className="flex flex-col items-center gap-2">
          <span className="text-white text-2xl font-bold tracking-tight select-none">LKS TV</span>
          <span className="text-zinc-400 text-sm select-none">Entrez le code d'accès</span>
        </div>

        <input
          type="password"
          inputMode="numeric"
          maxLength={10}
          autoFocus
          value={input}
          onChange={e => { setInput(e.target.value); setError(false); }}
          onKeyDown={handleKey}
          placeholder="••••"
          className={`w-40 text-center text-xl tracking-widest bg-zinc-900 border rounded-lg px-4 py-3 text-white placeholder-zinc-600 outline-none focus:ring-2 transition-colors ${
            error ? 'border-red-500 focus:ring-red-500/40' : 'border-zinc-700 focus:ring-white/20'
          }`}
        />

        {error && (
          <p className="text-red-400 text-sm -mt-2 select-none">Code incorrect</p>
        )}

        <button
          onClick={submit}
          className="px-6 py-2 bg-white text-zinc-950 font-semibold rounded-lg hover:bg-zinc-200 active:scale-95 transition-all text-sm"
        >
          Entrer
        </button>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-8px); }
          80% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
};

export default PinGate;
