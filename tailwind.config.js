/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'pop-in': { from: { opacity: 0, transform: 'translateY(8px) scale(.98)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        'slide-in': 'slide-in .22s cubic-bezier(.32,.72,0,1)',
        'fade-in': 'fade-in .15s ease-out',
        'pop-in': 'pop-in .18s cubic-bezier(.32,.72,0,1)',
      },
    },
  },
  plugins: [],
};
