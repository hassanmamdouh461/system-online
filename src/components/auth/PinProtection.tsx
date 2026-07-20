import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Lock, Delete, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

export function PinProtection() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [isLocked, setIsLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    const savedPin = localStorage.getItem('brewmaster_admin_pin');
    
    if (savedPin && user?.role !== 'manager') {
      setIsLocked(true);
      setPin('');
      setError(false);
    } else {
      setIsLocked(false);
    }
  }, [location.pathname, user]);

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      setError(false);
      const newPin = pin + num;
      setPin(newPin);
      
      if (newPin.length === 4) {
        verifyPin(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError(false);
  };

  const verifyPin = (enteredPin: string) => {
    const savedPin = localStorage.getItem('brewmaster_admin_pin');
    if (enteredPin === savedPin) {
      setIsLocked(false);
    } else {
      setError(true);
      setTimeout(() => setPin(''), 500); // clear after short delay
    }
  };

  const handleCancel = () => {
    navigate('/dashboard'); // Send back to safe zone if cancelled
  };

  if (!isLocked) {
    return <Outlet />;
  }

  return (
    <div className="flex-1 h-full bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-3xl shadow-lg border border-gray-100 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Lock size={32} />
        </div>
        
        <h2 className="text-2xl font-black text-gray-900 mb-2">{t('Enter PIN')}</h2>
        <p className="text-gray-500 mb-8">{t('Please enter your access code to continue')}</p>

        {/* PIN Dots */}
        <div className="flex justify-center gap-4 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div 
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-300 ${
                pin.length > i ? 'bg-indigo-600 scale-110' : 'bg-gray-200'
              } ${error ? 'bg-red-500 animate-pulse' : ''}`}
            />
          ))}
        </div>

        {error && (
          <div className="flex justify-center items-center gap-1.5 text-red-500 text-sm font-bold mb-6">
            <AlertCircle size={16} />
            <span>{t('Incorrect PIN')}</span>
          </div>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="bg-gray-50 hover:bg-gray-100 text-gray-800 font-mono text-2xl font-black py-4 rounded-2xl active:scale-95 transition-all"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-gray-600 font-bold active:scale-95 transition-all"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="bg-gray-50 hover:bg-gray-100 text-gray-800 font-mono text-2xl font-black py-4 rounded-2xl active:scale-95 transition-all"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="text-gray-400 hover:text-gray-600 flex justify-center items-center active:scale-95 transition-all"
          >
            <Delete size={28} />
          </button>
        </div>
      </div>
    </div>
  );
}
