import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: '#04182B',
        blue: { DEFAULT: '#034EAD', light: '#1a6bc9' },
        bg: { light: '#F4F8FC', body: '#F8FFFF' },
        border: '#E3EBF3',
        muted: '#5a6a7a',
        faint: '#8a9ab0',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['DM Serif Display', 'Georgia', 'serif'],
        mono: ['DM Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
