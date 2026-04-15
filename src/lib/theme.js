export const DARK = {
  bg: '#040710',
  surface: '#080D1C',
  surface2: '#0C1228',
  border: '#141E35',
  grid: '#0F1730',
  text: '#DCE8F8',
  muted: '#8AA8C8',
  blue: '#1E72F0',
  blueLight: '#5BA0FF',
  gold: '#C8962A',
  goldLight: '#E8B840',
  green: '#00C878',
  red: '#FF3D5A',
  orange: '#FF7830',
  shadow: '0 18px 50px rgba(0, 0, 0, 0.35)',
};

export const LIGHT = {
  bg: '#F3F5FA',
  surface: '#FFFFFF',
  surface2: '#EEF3FB',
  border: '#D6DFEE',
  grid: '#E6ECF5',
  text: '#0E1B2E',
  muted: '#647C9C',
  blue: '#1D63D8',
  blueLight: '#4B8AF0',
  gold: '#A67C00',
  goldLight: '#C89A00',
  green: '#0B8E5F',
  red: '#D92C49',
  orange: '#D16A1A',
  shadow: '0 18px 50px rgba(22, 40, 72, 0.08)',
};

export const getTheme = (mode) => (mode === 'light' ? LIGHT : DARK);
