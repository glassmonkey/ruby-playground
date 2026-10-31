import { extendTheme, type ThemeConfig } from "@chakra-ui/react";
import { designTokens } from "./design-tokens";

const config: ThemeConfig = {
  initialColorMode: "system",
  useSystemColorMode: true,
};

export default extendTheme({
  config,
  fonts: { heading: designTokens.font, body: designTokens.font },
  colors: { ruby: designTokens.ruby },
  semanticTokens: {
    colors: {
      ...designTokens.colors,
      accent: { default: "ruby.700", _dark: "ruby.400" },
    },
  },
  styles: {
    global: {
      body: { bg: "pageBg", color: "text" },
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
