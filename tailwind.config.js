/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 12px 40px rgba(0, 0, 0, 0.28)',
      },
      colors: {
        cordly: {
          bg: 'var(--bg-base)',
          surface: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
          hover: 'var(--bg-hover)',
          active: 'var(--bg-active)',
          accent: 'var(--accent)',
          'accent-hover': 'var(--accent-hover)',
          text: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          border: 'var(--border)',
          danger: 'var(--danger)',
          success: 'var(--success)',
          warning: 'var(--warning)',
          status: {
            online: 'var(--status-online)',
            idle: 'var(--status-idle)',
            dnd: 'var(--status-dnd)',
            offline: 'var(--status-offline)',
          },
        },
      },
      borderRadius: {
        control: '10px',
        card: '12px',
        modal: '16px',
      },
      ringColor: {
        cordly: 'var(--accent)',
      },
    },
  },
  plugins: [],
};

export default config;
