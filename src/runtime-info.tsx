import {
  Box,
  Flex,
  Heading,
  SimpleGrid,
  Skeleton,
  Text,
} from "@chakra-ui/react";
import type { RuntimeInfo } from "./runtime";
import RubyMark from "./ruby-mark";

export default function RuntimeInfoPanel({
  info,
  isLoading = false,
}: {
  info?: RuntimeInfo;
  isLoading?: boolean;
}) {
  return (
    <Flex
      as="section"
      aria-label="Ruby runtime environment"
      aria-busy={!info && isLoading}
      direction={{ base: "column", lg: "row" }}
      borderWidth="1px"
      borderColor="panelBorder"
      rounded="xl"
      overflow="hidden"
      mb={4}
      bg="panelBg"
    >
      <Flex
        bgGradient="linear(to-br, ruby.700, ruby.900)"
        color="white"
        align="center"
        justify="space-between"
        gap={5}
        px={5}
        py={4}
        minW={{ lg: "240px" }}
      >
        <Box>
          <Text fontSize="xs" color="ruby.100" mb={1}>
            Runtime environment
          </Text>
          <Skeleton
            isLoaded={!!info || !isLoading}
            minW="140px"
            minH={9}
            startColor="ruby.600"
            endColor="ruby.800"
          >
            <Heading
              as="h2"
              fontSize="2xl"
              fontWeight="800"
              letterSpacing="-0.04em"
            >
              Ruby {info?.version ?? "—"}
            </Heading>
          </Skeleton>
        </Box>
        <RubyMark boxSize={12} />
      </Flex>
      <SimpleGrid
        as="dl"
        columns={{ base: 2, md: 4 }}
        flex={1}
        alignItems="center"
      >
        {[
          { label: "Platform", value: info?.platform },
          { label: "Encoding", value: info?.encoding },
          { label: "Released", value: info?.releaseDate },
          {
            label: "Revision",
            value: info?.revision.slice(0, 10),
            title: info?.revision,
          },
        ].map(({ label, value, title }) => (
          <Box key={label} p={4} minW={0}>
            <Text as="dt" fontSize="xs" color="mutedText" mb={2}>
              {label}
            </Text>
            <Skeleton as="dd" isLoaded={!!info || !isLoading} minH={5}>
              <Text
                title={title}
                fontFamily="mono"
                fontSize="sm"
                fontWeight="600"
                overflowWrap="anywhere"
              >
                {value ?? "—"}
              </Text>
            </Skeleton>
          </Box>
        ))}
      </SimpleGrid>
    </Flex>
  );
}
