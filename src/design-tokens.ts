/** Shared visual values for the Playground theme and static tutorial pages. */
export const designTokens = {
  font: '"Plus Jakarta Sans", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
  ruby: {
    50: "#fdeae9",
    100: "#fadad3",
    200: "#f8bfbd",
    300: "#f5a9a7",
    400: "#f07f7b",
    500: "#eb544f",
    600: "#e62923",
    700: "#b8211c",
    800: "#8a1915",
    900: "#5c100e",
  },
  colors: {
    pageBg: { default: "#FAF7F1", _dark: "#171615" },
    panelBg: { default: "#ffffff", _dark: "#22201f" },
    frameBg: { default: "#F1EEE4", _dark: "#302b29" },
    panelBorder: { default: "#EDE9DD", _dark: "#48403c" },
    mutedText: { default: "#78716c", _dark: "#bfb7b1" },
    text: { default: "#292524", _dark: "#faf7f1" },
  },
} as const;

const themeVariables = (dark: boolean) => {
  const mode = dark ? "_dark" : "default";
  const colors = designTokens.colors;
  const variables = {
    bg: colors.pageBg[mode],
    panel: colors.panelBg[mode],
    text: colors.text[mode],
    muted: colors.mutedText[mode],
    border: colors.panelBorder[mode],
    accent: designTokens.ruby[dark ? 400 : 700],
    code: colors.frameBg[mode],
    "button-text": colors.pageBg[dark ? "_dark" : "default"],
    "font-body": designTokens.font,
  };
  return `color-scheme:${dark ? "dark" : "light"};${Object.entries(variables)
    .map(([name, value]) => `--${name}:${value};`)
    .join("")}`;
};

export const tutorialThemeCss = `:root{${themeVariables(false)}}\n:root[data-theme="dark"]{${themeVariables(true)}}\n@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){${themeVariables(true)}}}\n`;
