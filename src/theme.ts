import { extendTheme, type ThemeConfig } from "@chakra-ui/react";

const config: ThemeConfig = {
  initialColorMode: "system",
  useSystemColorMode: true,
};

const sans =
  '"Plus Jakarta Sans", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';

export default extendTheme({
  config,
  fonts: { heading: sans, body: sans },
  colors: {
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
  },
  semanticTokens: {
    colors: {
      pageBg: { default: "#FAF7F1", _dark: "#171615" },
      panelBg: { default: "white", _dark: "#22201f" },
      frameBg: { default: "#F1EEE4", _dark: "#302b29" },
      panelBorder: { default: "#EDE9DD", _dark: "#48403c" },
      mutedText: { default: "#78716c", _dark: "#bfb7b1" },
      accent: { default: "ruby.700", _dark: "ruby.400" },
    },
  },
  styles: {
    global: {
      body: { bg: "pageBg", color: "#292524", _dark: { color: "#faf7f1" } },
    },
  },
  components: {
    Button: { defaultProps: { colorScheme: "ruby" } },
    Checkbox: { defaultProps: { colorScheme: "ruby" } },
    Switch: { defaultProps: { colorScheme: "ruby" } },
    Select: { defaultProps: { focusBorderColor: "ruby.600" } },
    Link: { baseStyle: { _hover: { color: "accent" } } },
  },
});
