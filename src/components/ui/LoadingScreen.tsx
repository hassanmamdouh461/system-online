import React from 'react';
import { Loader2 } from 'lucide-react';

export function LoadingScreen({ message = 'BrewMaster Coffee POS' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] h-full w-full py-12 px-4 bg-gray-50/50">
      <div className="p-6 bg-white/95 backdrop-blur-xl rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center gap-3 text-center">
        <div className="p-3 bg-mocha-100 text-mocha-700 rounded-xl shadow-inner">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-800">Brew<span className="text-caramel">Master</span></h2>
          <p className="text-xs text-gray-500 font-medium mt-0.5">{message}</p>
        </div>
      </div>
    </div>
  );
}

