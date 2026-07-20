import React from 'react';
import { motion } from 'framer-motion';
import { Coffee, Bean } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col items-center justify-center">
      <div className="relative">
        {/* Pulsing Background */}
        <motion.div
           animate={{
             scale: [1, 1.2, 1],
             opacity: [0.3, 0.6, 0.3],
           }}
           transition={{
             duration: 2,
             repeat: Infinity,
             ease: "easeInOut"
           }}
           className="absolute inset-0 bg-caramel rounded-full blur-xl"
        />

        {/* Logo Container */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 bg-gray-800 p-8 rounded-full border border-gray-700 shadow-2xl"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          >
            <Coffee className="w-16 h-16 text-caramel" />
          </motion.div>
        </motion.div>

        {/* Floating Icons */}
        <motion.div
          animate={{ y: [-10, 10, -10] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-12 -right-8 text-white/20"
        >
          <Coffee size={32} />
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 text-center"
      >
        <h1 className="text-3xl font-bold text-white mb-2">Brew<span className="text-caramel">Master</span></h1>
        <div className="flex items-center gap-1 justify-center">
          <motion.div 
            animate={{ height: [4, 12, 4] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0 }}
            className="w-1 bg-caramel rounded-full" 
          />
          <motion.div 
            animate={{ height: [4, 12, 4] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
            className="w-1 bg-caramel rounded-full" 
          />
          <motion.div 
            animate={{ height: [4, 12, 4] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
            className="w-1 bg-caramel rounded-full" 
          />
        </div>
        <p className="text-gray-500 text-sm mt-4 font-medium tracking-widest uppercase">Loading System</p>
      </motion.div>
    </div>
  );
}
