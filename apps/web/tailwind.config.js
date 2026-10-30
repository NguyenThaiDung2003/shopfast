// Design system "Modern Vietnamese Retail Flow" – rút từ apps/web/design (Google Stitch).
// Component chỉ dùng tên token dưới đây, không hardcode mã màu.
// Bo góc theo DESIGN.md (config export của Stitch đặt nhầm full = 12px).

const font = (size, lineHeight, fontWeight, letterSpacing) => [
  size,
  letterSpacing ? { lineHeight, fontWeight, letterSpacing } : { lineHeight, fontWeight },
];

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#faf8ff',
        'on-background': '#131b2e',
        surface: '#faf8ff',
        'surface-dim': '#d2d9f4',
        'surface-bright': '#faf8ff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f2f3ff',
        'surface-container': '#eaedff',
        'surface-container-high': '#e2e7ff',
        'surface-container-highest': '#dae2fd',
        'surface-variant': '#dae2fd',
        'surface-tint': '#3755c3',
        'on-surface': '#131b2e',
        'on-surface-variant': '#444653',
        'inverse-surface': '#283044',
        'inverse-on-surface': '#eef0ff',
        outline: '#757684',
        'outline-variant': '#c4c5d5',

        primary: '#00288e',
        'on-primary': '#ffffff',
        'primary-container': '#1e40af',
        'on-primary-container': '#a8b8ff',
        'inverse-primary': '#b8c4ff',
        'primary-fixed': '#dde1ff',
        'primary-fixed-dim': '#b8c4ff',
        'on-primary-fixed': '#001453',
        'on-primary-fixed-variant': '#173bab',

        secondary: '#9d4300',
        'on-secondary': '#ffffff',
        'secondary-container': '#fd761a',
        'on-secondary-container': '#5c2400',
        'secondary-fixed': '#ffdbca',
        'secondary-fixed-dim': '#ffb690',
        'on-secondary-fixed': '#341100',
        'on-secondary-fixed-variant': '#783200',

        tertiary: '#003d28',
        'on-tertiary': '#ffffff',
        'tertiary-container': '#00563a',
        'on-tertiary-container': '#5bcf9e',
        'tertiary-fixed': '#85f8c4',
        'tertiary-fixed-dim': '#68dba9',
        'on-tertiary-fixed': '#002114',
        'on-tertiary-fixed-variant': '#005137',

        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',

        // DESIGN.md: giá khuyến mãi/flash sale và sao đánh giá.
        sale: '#dc2626',
        rating: '#f59e0b',
        scrim: 'rgb(15 23 42 / 0.4)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-hero': font('40px', '48px', '800', '-0.02em'),
        'display-hero-mobile': font('28px', '36px', '800', '-0.01em'),
        'headline-lg': font('30px', '38px', '700', '-0.015em'),
        'headline-lg-mobile': font('24px', '32px', '700', '-0.01em'),
        'headline-md': font('22px', '28px', '700'),
        'headline-sm': font('18px', '24px', '600'),
        'title-md': font('16px', '22px', '600'),
        'title-sm': font('14px', '20px', '600'),
        'price-lg': font('24px', '28px', '700', '-0.01em'),
        'price-md': font('18px', '22px', '700'),
        'price-sm': font('14px', '18px', '700'),
        'body-lg': font('16px', '24px', '400'),
        'body-md': font('14px', '20px', '400'),
        'body-sm': font('12px', '16px', '400'),
        'label-md': font('13px', '16px', '600'),
        'label-sm': font('11px', '14px', '600', '0.02em'),
      },
      spacing: {
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '0.75rem',
        'space-lg': '1rem',
        'space-xl': '1.5rem',
        gutter: '1rem',
        'gutter-mobile': '0.5rem',
        margin: '1.5rem',
        'margin-mobile': '0.75rem',
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.04)',
        'card-hover': '0 10px 15px -3px rgb(15 23 42 / 0.08), 0 4px 6px -4px rgb(15 23 42 / 0.04)',
        float: '0 20px 25px -5px rgb(15 23 42 / 0.1), 0 8px 10px -6px rgb(15 23 42 / 0.04)',
        modal: '0 25px 50px -12px rgb(15 23 42 / 0.25)',
        header: '0 1px 8px rgb(0 0 0 / 0.06)',
      },
      maxWidth: {
        content: '80rem',
      },
      keyframes: {
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'toast-in': 'toast-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};
