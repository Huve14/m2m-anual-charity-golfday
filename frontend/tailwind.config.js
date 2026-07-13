/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#dcddde',
          100: '#dcddde',
          500: '#0c1735',
          600: '#0c1735',
          700: '#0c1735',
          800: '#0c1735',
          900: '#0c1735',
        },
        cream: {
          50: '#ffffff',
          100: '#ffffff',
          200: '#dcddde',
          300: '#dcddde',
          400: '#dcddde',
        },
        signal: {
          100: '#dcddde',
          300: '#ed1c24',
          500: '#ed1c24',
        },
        ink: {
          DEFAULT: '#0c1735',
          soft: '#0c1735',
          mute: '#dcddde',
        },
      },
      boxShadow: {
        panel: '0 20px 60px rgba(18, 32, 74, 0.12)',
      },
    },
  },
  plugins: [],
};
