export const INITIAL_CODE = `# Draw "ruby" using the word "ruby".
letters = [
  ["...", "...", "##.", "#.#", "#..", "#..", "#.."], # r
  ["...", "...", "#.#", "#.#", "#.#", "#.#", ".##"], # u
  ["#..", "#..", "##.", "#.#", "#.#", "#.#", "##."], # b
  ["...", "...", "#.#", "#.#", ".##", "..#", "##."]  # y
]

letters.transpose.each do |row|
  puts row.join(".").chars.map { |pixel| pixel == "#" ? "ruby" : "    " }.join
end
`;
