/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Coffee Shop Premium Theme
        mocha: {
          50: '#F9F6F0',
          100: '#F3EDE3',
          200: '#E8DDD0',
          300: '#D4C3B0',
          400: '#C89F7A',
          500: '#A67C52',
          600: '#8B6843',
          700: '#6B4E31',
          800: '#4A3B32',
          900: '#2D2419',
        },
        cream: {
          DEFAULT: '#FBF9F6',
          dark: '#F9F6F0',
        },
        coffee: {
          light: '#8B6843',
          DEFAULT: '#6B4E31',
          dark: '#4A3B32',
        },
        caramel: {
          light: '#D4C3B0',
          DEFAULT: '#C89F7A',
          dark: '#A67C52',
        }
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      height: {
        'screen-safe': 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
      },
      screens: {
        'xs': '475px',
        'mobile': {'max': '767px'},
        'tablet': {'min': '768px', 'max': '1023px'},
      },
    },
  },
  plugins: [],
};
