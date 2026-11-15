export const INITIAL_GEMFILE = `gem "artii", "= 2.1.2"\n`;

export const INITIAL_CODE = `require "artii"

message = "Ruby"
caption = "Made with Ruby + gems"
art = Artii::Base.new(font: "slant").asciify(message)
lines = art.lines.map(&:chomp)
width = [lines.map(&:length).max, caption.length].max
border = "+#{'-' * (width + 2)}+"

puts border
(lines + ["", caption]).each { |line| puts "| #{line.ljust(width)} |" }
puts border
`;

/** Safe pure-Ruby code for malformed or partial shares that omit the Gemfile. */
export const SHARE_FALLBACK_CODE = `# Draw "ruby" using the word "ruby".
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
