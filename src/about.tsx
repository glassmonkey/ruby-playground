import { Box, Heading, Link, Text } from "@chakra-ui/react";

export default function About() {
  return (
    <Box as="section" id="about" aria-labelledby="about-heading" mt={6}>
      <Heading as="h2" id="about-heading" size="md" mb={3}>
        About Ruby Playground
      </Heading>
      <Heading as="h3" size="sm" mb={2}>
        Description
      </Heading>
      <Text mb={4}>
        Run and share small Ruby programs for free, without installation or an
        account.
      </Text>
      <Heading as="h3" size="sm" mb={2}>
        Usage
      </Heading>
      <Text mb={2}>
        Edit code to run it automatically. Use puts or p to display values.
        Switch versions to compare the same program.
      </Text>
      <Text mb={4}>
        Copy the URL to share your code and selected version or save them for
        later.
      </Text>
      <Box as="section" aria-labelledby="tutorial-introduction-heading" mb={4}>
        <Heading as="h3" id="tutorial-introduction-heading" size="sm" mb={2}>
          Learn Ruby
        </Heading>
        <Text>
          Learn step by step with the{" "}
          <Link href="/tutorial/" color="accent">
            Ruby Tutorial
          </Link>
          . Run each Example, then try Experiments to explore the code.
        </Text>
      </Box>
      <Heading as="h3" size="sm" mb={2}>
        Notes
      </Heading>
      <Text mb={2}>
        Each run starts fresh. Rails, installing extra gems and interactive
        input are not supported. The first run may take longer while Ruby loads.
      </Text>
      <Text>
        Shared URLs include your code and run automatically when opened. Do not
        enter secrets or open links you do not trust.
      </Text>
    </Box>
  );
}
