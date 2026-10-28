export const INITIAL_CODE = `def fractal(rows, depth)
  return rows if depth.zero?

  width = rows.map(&:size).max * 2 + 1
  top = rows.map { |row| row.center(width) }
  bottom = rows.map { |row| "#{row} #{row}".center(width) }
  fractal(top + bottom, depth - 1)
end

puts fractal(%w[Hello Ruby!], 3)
`;
