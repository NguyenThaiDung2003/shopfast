---
name: Modern Vietnamese Retail Flow
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#444653'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#757684'
  outline-variant: '#c4c5d5'
  surface-tint: '#3755c3'
  primary: '#00288e'
  on-primary: '#ffffff'
  primary-container: '#1e40af'
  on-primary-container: '#a8b8ff'
  inverse-primary: '#b8c4ff'
  secondary: '#9d4300'
  on-secondary: '#ffffff'
  secondary-container: '#fd761a'
  on-secondary-container: '#5c2400'
  tertiary: '#003d28'
  on-tertiary: '#ffffff'
  tertiary-container: '#00563a'
  on-tertiary-container: '#5bcf9e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dde1ff'
  primary-fixed-dim: '#b8c4ff'
  on-primary-fixed: '#001453'
  on-primary-fixed-variant: '#173bab'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#ffb690'
  on-secondary-fixed: '#341100'
  on-secondary-fixed-variant: '#783200'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  display-hero:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-hero-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  title-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  title-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  price-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.01em
  price-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 22px
  price-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 18px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.5rem
  margin: 1.5rem
  margin-mobile: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system expresses speed, reliability, and modern transactional clarity tailored for the Vietnamese digital retail ecosystem. The visual language blends contemporary utility with vibrant e-commerce dynamism—designed to instill transactional confidence while driving swift purchasing decisions.

### Personality & Emotional Response
- **Trustworthy & Secure:** Grounded structural layouts and reassuring navy tones establish high credibility for payments and genuine goods.
- **Energetic & Commercial:** High-visibility amber-orange accents drive urgency, highlighting discounts, flash sales, and direct conversions without visual fatigue.
- **Frictionless & Efficient:** Clean spatial hierarchy, scannable data displays, and immediate feedback loops optimize high-volume browsing across dense product catalogs.

### Design Movement
The aesthetic combines **Modern Corporate Precision** with **Utility Retail Minimalism**:
- Pristine neutral surfaces (`#F8FAFC`, `#F1F5F9`) paired with crisp white card containers.
- Clean 1px soft dividers and subtle drop shadows rather than heavy structural borders.
- Dedicated focal areas for promotional urgency (flash sale tickers, badges, and high-contrast CTA buttons).

## Colors

The palette establishes an immediate division between institutional trust and commercial motivation.

### Color Roles
- **Primary (`#1E40AF` - Deep Blue):** Anchors core brand identity, headers, main navigation, checkout steps, authoritative badges ("Chính hãng"), and verified merchant marks.
- **Secondary (`#F97316` - Vibrant Orange):** Reserved strictly for primary conversion drivers: "Thêm vào giỏ", "Mua ngay", countdown banners, promotional tags, flash sale tickers, and active price tags.
- **Tertiary (`#059669` - Emerald Green):** Used for logistical reassurance: stock status, free shipping ("Freeship"), and voucher application successes.
- **Neutral Core (`#0F172A` - Slate Dark):** High-contrast text color for primary headings and standard titles.
- **Neutral Canvas (`#F8FAFC` to `#F1F5F9`):** Ground foundation for pages, contrasting against pure white (`#FFFFFF`) card containers.
- **Critical & Sale Red (`#DC2626`):** Dedicated to promotional discount tags ("Giảm 25%"), limited-time alerts, and error states.

### Application Rules
- Never use the primary blue for pricing or primary conversion buttons; reserve pricing prominence strictly for the secondary orange or critical red to maintain visual distinction.
- In dark surfaces or inverted promo blocks, maintain `#FFFFFF` for primary text and elevate accent orange elements using high-contrast borders or solid badge fills.

## Typography

Typography relies entirely on **Inter**, optimized for high legibility across dense product grids, tabular numerical layouts, and Vietnamese diacritical marks (e.g., dấu ngã, hỏi, nặng, sắc, huyền).

### Diacritic and Localization Considerations
- Ensure line-height values have sufficient clearance (minimum 1.35x to 1.45x of font size) to prevent diacritical marks on uppercase Vietnamese characters (e.g., Ắ, Ộ, Ở) from colliding with upper element containers.
- Numerical glyphs utilize tabular or standard proportional figures to maintain neat horizontal and vertical alignment in pricing matrices and checkout tallies.

### Formatting Standards
- **Currency formatting:** Strictly follow Vietnamese currency standards: `1.290.000 ₫` or `129.000 ₫`. The currency symbol (`₫`) follows a non-breaking space after the dot-delimited thousands.
- **Original price comparison:** Render original prices in `body-sm` with a strikethrough (e.g., ~~1.720.000 ₫~~) positioned directly adjacent to or beneath the active price token.

## Layout & Spacing

The layout model uses a fluid-responsive column grid system calibrated to handle varying inventory densities, from rapid mobile skimming to widescreen dashboard comparisons.

### Grid & Breakpoints
- **Desktop (1200px+):** 12-column layout, max-width 1280px, 24px margins, 16px gutters. Product listings default to 5 or 6 items per row.
- **Tablet (768px – 1199px):** 8-column layout, fluid margins (16px to 24px), 16px gutters. Product listings default to 3 or 4 items per row.
- **Mobile (< 768px):** 4-column layout, 12px outer canvas margins, 8px gutters. Product grids display strictly 2 items per row to maximize viewport utility and image visibility.

### Layout Rhythm
- **Micro Spacing (`space-xs` to `space-sm`):** Reserved for metadata bundling—star ratings beside review counts, discount chips alongside prices, and category pill inline padding.
- **Macro Spacing (`space-md` to `space-xl`):** Applied between card content segments, section title headers, and promotional hero units.

## Elevation & Depth

Visual hierarchy uses a refined light-surface stacking model. Crisp white cards layer over cooler off-white foundations using low-opacity ambient shadows, avoiding dark outlines that clutter dense catalogs.

### Depth Levels
- **Canvas Base (Level 0):** `#F8FAFC` to `#F1F5F9`. Flat, non-elevated background for catalog browsing.
- **Resting Product Card (Level 1):** Solid `#FFFFFF` background with an ambient shadow: `0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.04)`. Accompanied by a subtle border: `1px solid rgba(226, 232, 240, 0.8)`.
- **Card Hover & Focus (Level 2):** Elevated card state: `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)`. Card translates vertically by `-2px`.
- **Floating Overlays & Sticky Actions (Level 3):** Bottom navigation bars, mobile checkout bars, and category tooltips: `0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04)`.
- **Modals & Drawers (Level 4):** Standard modal shadow paired with a backdrop scrim (`rgba(15, 23, 42, 0.4)`).

## Shapes

The design system standardizes on a balanced, approachable geometric profile using 8px (`rounded-lg` under Level 1) for primary containers.

### Shape Tokens & Application
- **Default Corners (4px / 0.25rem):** Micro badges ("Giảm 25%", "Freeship"), input fields, table rows, and quantity counter controls.
- **Card & Banner Containers (8px / 0.5rem - `rounded-lg`):** Product cards, hero banners, filter containers, and promotional modules.
- **Interactive Floating Elements (12px / 0.75rem - `rounded-xl`):** Dropdown menus, floating bottom action bars, and modal dialogue containers.
- **Full Radius (9999px / Pill):** Category selection chips, search bar container, avatar rings, and promotional countdown pill badges.

## Components

### Product Cards
- **Container:** Pure `#FFFFFF` surface, 8px border radius, 1px border (`#E2E8F0`), level-1 shadow.
- **Image Container:** Aspect ratio 1:1, full-bleed top or contained with 8px internal padding. Background color `#F8FAFC`.
- **Tags & Badges:** Pinned top-left over image.
  - "Chính hãng": Deep blue background (`#1E40AF`), white text, 4px border radius.
  - "Giảm [X]%": Red background (`#EF4444`) or secondary orange (`#F97316`), white text, bold, uppercase micro text.
- **Content Block:** Internal padding 12px. Title truncated to 2 lines max (`title-sm`), followed by star rating display, price block, and quick-add CTA.

### Buttons & CTAs
- **Primary CTA ("Mua ngay" / "Thêm vào giỏ"):**
  - Background: Vibrant Orange (`#F97316`), hover state `#EA580C`, active state `#C2410C`.
  - Text: White, font weight 600, height 40px (desktop) or 44px (touch-first mobile).
- **Secondary Action:**
  - Background: Light tint (`#FFF7ED`), text and border `#F97316` (1px solid), providing a prominent alternative for "Thêm vào giỏ".
- **Navigation/Account Button:**
  - Deep blue fill (`#1E40AF`) or neutral outline.

### Category Chips & Pills
- **Base Style:** Fully rounded (pill), height 32px, padding horizontal 16px.
- **Default State:** `#FFFFFF` background, `#E2E8F0` border, `#334155` text (`body-sm`).
- **Active State:** `#1E40AF` background, `#FFFFFF` text, shadow-sm, or subtle accent tint (`#EFF6FF` background with `#1E40AF` text and border).

### Star Rating
- **Visuals:** 5-star metric rendered in warning gold (`#F59E0B`), size 12px × 12px.
- **Text Companion:** Numerical score (e.g., `4.8`) in bold text followed by parenthesized order volume (e.g., `(1.2k)` or `Đã bán 3,4k`) in `#64748B`.

### Price Display Module
- **Current Price:** Formatted in `price-md` or `price-lg`, color `#F97316` (or `#DC2626` during flash promotions).
- **Previous Price:** Formatted in `body-sm`, strikethrough, color `#94A3B8`.
- **Currency Indicator:** Trailing non-breaking space with `₫` symbol standard across all views.

### Countdown Hero Banner
- **Container:** High-contrast gradient or solid deep blue background (`#1E40AF`), 8px to 12px corner radius.
- **Flash Sale Header:** Displayed alongside a digital clock or countdown unit: three separate white or dark slate boxes showing hours, minutes, and seconds separated by colons.
- **Microcopy:** "KẾT THÚC TRONG" or "GIÁ SỐC HÔM NAY".

### Inputs & Search Bars
- **Main Marketplace Search:** Full pill shape, height 44px, white background, light gray border (`#CBD5E1`), leading search icon, trailing orange action button labeled "Tìm kiếm".