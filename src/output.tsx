import { Box } from "@chakra-ui/react";

export default function Output({ text }: { text: string }) {
  return (
    <Box
      as="pre"
      data-testid="preview-console"
      whiteSpace="pre"
      flex={1}
      p={3}
      overflow="auto"
    >
      {text}
    </Box>
  );
}
