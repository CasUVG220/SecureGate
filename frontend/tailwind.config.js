/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1', // Indigo primary
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        dark: {
          900: '#0B0F19', // Deep dark violet-blue background
          800: '#131A2A', // Surface color
          700: '#1E293B', // Border/Hover
        }
      },
      boxShadow: {
        'glow': '0 0 15px rgba(99, 102, 241, 0.4)',
        'glow-lg': '0 0 25px rgba(99, 102, 241, 0.6)',
      }
    },
  },
  plugins: [],
}
