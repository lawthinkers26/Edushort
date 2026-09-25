/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          900: '#2E1065',
        },
        ink: {
          950: '#07060B',
          900: '#0E0C16',
          800: '#171422',
          700: '#262233',
          500: '#6B6680',
          300: '#A8A3BA',
        },
        gold: '#FBBF24',
      },
    },
  },
  plugins: [],
};
