const paths = {
  paw: '<ellipse cx="12" cy="16" rx="6" ry="4.6"/><ellipse cx="5" cy="9" rx="2.3" ry="3" transform="rotate(-25 5 9)"/><ellipse cx="10" cy="5.5" rx="2.2" ry="3"/><ellipse cx="16" cy="5.8" rx="2.2" ry="3"/><ellipse cx="20" cy="10" rx="2" ry="2.8" transform="rotate(25 20 10)"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  muted: '<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v6M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3m-4 0h8"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v16"/>',
  leaf: '<path d="M20 3C8 1 2 6 4 14c1 5 8 6 12 2 3-3 3-7 4-13ZM3 22 15 10"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm8-2v4m-2-2h4"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-3 2 2-7a9 9 0 1 1 18-4Z"/><path d="M7 10h10M7 14h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  rotate: '<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${name === 'paw' ? 'currentColor' : 'none'}" stroke="${name === 'paw' ? 'none' : 'currentColor'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.spark}</svg>`;
