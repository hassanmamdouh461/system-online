import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    this.setState({ error, errorInfo });

    const isChunkLoadError = 
      error.name === 'ChunkLoadError' || 
      error.message?.includes('Failed to fetch dynamically imported module') ||
      error.message?.includes('Expected a JavaScript-or-Wasm module script') ||
      error.message?.includes('importing a module script failed');

    if (isChunkLoadError) {
      const lastReload = sessionStorage.getItem('chunk_error_reload');
      if (!lastReload || Date.now() - parseInt(lastReload, 10) > 10000) {
        sessionStorage.setItem('chunk_error_reload', Date.now().toString());
        window.location.reload();
      }
    }
  }


  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto border border-red-500/30">
              <AlertTriangle size={32} />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">حدث خطأ غير متوقع في التطبيق</h2>
              <p className="text-slate-400 text-sm dir-rtl">
                حدثت مشكلة أثناء عرض الصفحة. لا تقلق، يمكنك إعادة التخصيص وإعادة المحاولة.
              </p>
            </div>

            {this.state.error && (
              <div className="bg-slate-950 rounded-lg p-4 text-xs font-mono text-red-300 text-left overflow-x-auto max-h-40 border border-slate-800">
                {this.state.error.toString()}
              </div>
            )}

            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center space-x-2 space-x-reverse bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-6 rounded-xl transition duration-200 shadow-lg cursor-pointer"
            >
              <RefreshCw size={18} className="animate-spin-hover" />
              <span>إعادة تحميل التطبيق</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
