import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, ColorModeScript } from "@chakra-ui/react";
import theme from "./theme";
import App from "./app";
import { resolveTutorialRoute } from "./tutorial/routes";
import "./fonts.css";
import "./brand.css";

const root = document.getElementById("root")!;
const route = resolveTutorialRoute(window.location.pathname);
if (route.kind === "redirect") {
  window.location.replace(
    `${route.destination}${window.location.search}${window.location.hash}`,
  );
} else if (route.kind === "page") {
  void import("./tutorial/app").then(({ default: TutorialApp }) => {
    const app = <TutorialApp version={route.version} slug={route.slug} />;
    if (root.hasAttribute("data-prerendered")) ReactDOM.hydrateRoot(root, app);
    else ReactDOM.createRoot(root).render(app);
  });
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ColorModeScript initialColorMode={theme.config.initialColorMode} />
      <ChakraProvider theme={theme}>
        <App />
      </ChakraProvider>
    </React.StrictMode>,
  );
}
