import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class', // Disable automatic dark mode
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff', // Sky-ish white for backgrounds
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9', // Sky blue accessible
          600: '#0284c7', // Deep Sky
          700: '#0369a1',
          800: '#075985', // Professional Navy/Teal tone
          900: '#0c4a6e', // Deepest Navy
          950: '#082f49',
        },
        accent: {
          50: '#f8fafc', // Slate-50
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b', // Slate-800
          900: '#0f172a', // Slate-900
          950: '#020617',
        },
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(to right, #f8fafc, #f1f5f9)', // Subtle Slate gradient
        'gradient-card': 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', // Clean card gradient
        'gradient-button': 'linear-gradient(to right, #0c4a6e, #075985)', // Deep Navy gradient
      },
      boxShadow: {
        'sm-blue': '0 1px 2px 0 rgba(7, 89, 133, 0.05)',
        'md-blue': '0 4px 6px -1px rgba(7, 89, 133, 0.1)',
        'lg-blue': '0 10px 15px -3px rgba(7, 89, 133, 0.15)',
        'xl-blue': '0 20px 25px -5px rgba(7, 89, 133, 0.2)',
      },
      animation: {
        'shimmer': 'shimmer 1.5s infinite',
        'pulse-soft': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
