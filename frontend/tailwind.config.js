/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#12181f', soft: '#5b6a7a' },
        rust: { DEFAULT: '#b3502a', dark: '#8c3d1f', light: '#f3e3dc' },
      },
    },
  },
  plugins: [],
}
