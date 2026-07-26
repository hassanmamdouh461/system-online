import { Loader2 } from 'lucide-react';

interface InlinePageSpinnerProps {
  message?: string;
}

export function InlinePageSpinner({ message = 'جاري التحميل...' }: InlinePageSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[350px] w-full py-12 px-4">
      <div className="p-6 bg-white/95 backdrop-blur-xl rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center gap-3">
        <div className="p-3 bg-mocha-50 text-mocha-700 rounded-xl">
          <Loader2 className="w-7 h-7 animate-spin" />
        </div>
        <span className="text-sm font-semibold text-gray-700">{message}</span>
      </div>
    </div>
  );
}
