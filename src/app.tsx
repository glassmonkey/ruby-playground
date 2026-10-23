import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  SimpleGrid,
  Text,
  Textarea,
} from "@chakra-ui/react";

export const INITIAL_CODE = 'puts "Hello, Ruby!"\n';

export default function App() {
  const [code, setCode] = useState(INITIAL_CODE);
  return (
    <Box minH="100vh" bg="gray.50" color="gray.800">
      <Box as="header" bg="white" borderBottomWidth="1px" py={5}>
        <Container maxW="7xl">
          <Flex align="center" gap={3} wrap="wrap">
            <Heading size="lg">Ruby Playground</Heading>
            <Badge colorScheme="orange">Environment preview</Badge>
          </Flex>
          <Text mt={2} color="gray.600">
            ブラウザで Ruby を学ぶための、新しい開発環境。
          </Text>
        </Container>
      </Box>
      <Container as="main" maxW="7xl" py={8}>
        <Box
          borderWidth="1px"
          borderColor="orange.200"
          bg="orange.50"
          rounded="lg"
          p={4}
          mb={6}
        >
          <Text>
            環境セットアップ段階です。Ruby の実行・URL 共有・HTML
            プレビューは、次の実装で追加します。
          </Text>
        </Box>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={5}>
          <Box bg="white" borderWidth="1px" rounded="lg" p={5}>
            <Heading as="h2" size="md" mb={4}>
              エディター
            </Heading>
            <Textarea
              aria-label="Ruby source"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              fontFamily="mono"
              minH="320px"
              spellCheck={false}
            />
            <Flex mt={4} gap={3}>
              <Button colorScheme="red" isDisabled>
                実行（準備中）
              </Button>
              <Button onClick={() => setCode(INITIAL_CODE)}>
                サンプルに戻す
              </Button>
            </Flex>
          </Box>
          <Box bg="white" borderWidth="1px" rounded="lg" p={5}>
            <Heading as="h2" size="md" mb={4}>
              出力
            </Heading>
            <Text color="gray.600">
              Ruby WASM の接続は次のステップです。まだコードは実行されません。
            </Text>
          </Box>
        </SimpleGrid>
        <Text as="footer" mt={6} fontSize="sm" color="gray.600">
          React · TypeScript · Vite · Chakra UI / Ruby 4.0 WASM dependency
          prepared
        </Text>
      </Container>
    </Box>
  );
}
