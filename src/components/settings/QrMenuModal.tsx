import React, { useState } from 'react';
import { X, Copy, Check, Printer, Download, QrCode } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../../context/LanguageContext';

interface QrMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QrMenuModal({ isOpen, onClose }: QrMenuModalProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  
  const publicMenuUrl = 'https://tyt-seven.vercel.app/#/public-menu';
  const qrCodeImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(publicMenuUrl)}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicMenuUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(qrCodeImageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'brewmaster-menu-qr.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download QR code:', error);
      // Fallback: open in new window for direct save
      window.open(qrCodeImageUrl, '_blank');
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Print Menu QR Code - BrewMaster</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: white;
              color: #2D2419;
              text-align: center;
            }
            .container {
              border: 5px double #6B4E31;
              padding: 50px;
              border-radius: 28px;
              max-width: 420px;
              display: flex;
              flex-direction: column;
              align-items: center;
              box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);
            }
            .logo {
              font-size: 36px;
              font-weight: 800;
              margin-bottom: 4px;
              color: #6B4E31;
              letter-spacing: -0.5px;
            }
            .tagline {
              font-size: 16px;
              color: #8B6843;
              margin-bottom: 30px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .qr-wrapper {
              background: white;
              padding: 15px;
              border: 1px solid #E8DDD0;
              border-radius: 20px;
              margin-bottom: 30px;
            }
            .qr-img {
              width: 260px;
              height: 260px;
              display: block;
            }
            .divider {
              width: 60px;
              height: 3px;
              background: #C89F7A;
              margin-bottom: 24px;
              border-radius: 9px;
            }
            .instructions {
              font-size: 16px;
              color: #4A3B32;
              line-height: 1.6;
            }
            .arabic {
              direction: rtl;
              font-weight: bold;
              margin-bottom: 6px;
              font-size: 19px;
            }
            .english {
              font-weight: 500;
              font-size: 15px;
              color: #8B6843;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">BrewMaster</div>
            <div class="tagline">✦ Premium Coffee & Treats ✦</div>
            <div class="qr-wrapper">
              <img class="qr-img" src="${qrCodeImageUrl}" alt="QR Code" />
            </div>
            <div class="divider"></div>
            <div class="instructions">
              <div class="arabic">امسح الرمز لتصفح المنيو والأسعار</div>
              <div class="english">Scan QR Code to view menu & availability</div>
            </div>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
                window.close();
              }, 600);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 15 }}
            className="relative w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl border border-mocha-100 z-10 p-6 flex flex-col items-center"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X size={18} />
            </button>

            {/* Title */}
            <div className="flex items-center gap-2 mb-1 mt-2 text-mocha-700">
              <QrCode className="w-6 h-6 text-caramel" />
              <h2 className="text-xl font-bold text-gray-900">{t('QR Code Menu')}</h2>
            </div>
            <p className="text-xs text-gray-500 text-center mb-6 px-4">
              {t('Show or print this code so customers can scan it to browse the menu, pricing, and availability directly on their phones.')}
            </p>

            {/* QR Card Poster Preview */}
            <div className="bg-mocha-50 border border-mocha-100 p-5 rounded-2xl flex flex-col items-center shadow-inner w-full max-w-[280px] mb-6 text-gray-900">
              <span className="font-extrabold text-mocha-800 text-lg tracking-wide mb-1">BrewMaster</span>
              <span className="text-[9px] text-mocha-400 font-semibold tracking-widest uppercase mb-4">✦ Menu Stand ✦</span>
              
              {/* QR Image Frame */}
              <div className="bg-white p-3 rounded-xl shadow-md border border-mocha-100/50">
                <img
                  src={qrCodeImageUrl}
                  alt="Customer Menu QR Code"
                  className="w-40 h-40 object-contain"
                />
              </div>
              
              <div className="mt-4 text-center">
                <p className="text-xs font-bold text-mocha-700 mb-0.5">{t('Scan QR Code to view menu')}</p>
                <p className="text-[10px] text-mocha-400 font-medium">{t('Scan to view menu')}</p>
              </div>
            </div>

            {/* URL Display */}
            <div className="w-full flex items-center bg-gray-50 border border-gray-200 rounded-xl p-2.5 mb-6 text-xs text-gray-600">
              <span className="flex-1 truncate mr-2 font-mono select-all text-left">{publicMenuUrl}</span>
              <button
                onClick={handleCopyLink}
                className="shrink-0 p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-mocha-700 hover:bg-mocha-50 transition-colors shadow-sm flex items-center justify-center"
                title="Copy Link"
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              </button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3 w-full">
              <button
                onClick={handlePrint}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-mocha-700 hover:bg-mocha-800 text-white rounded-xl font-semibold shadow-md shadow-mocha-700/20 transition-all active:scale-[0.98] text-sm"
              >
                <Printer size={16} />
                <span>{t('Print Code')}</span>
              </button>
              
              <button
                onClick={handleDownload}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-mocha-100 hover:bg-mocha-200 text-mocha-800 rounded-xl font-semibold border border-mocha-200 transition-all active:scale-[0.98] text-sm"
              >
                <Download size={16} />
                <span>{t('Download Image')}</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
