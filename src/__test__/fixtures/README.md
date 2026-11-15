# Synthetic fileutils component archives

These archives exist only for Ruby WASM component tests. They are not the
published `fileutils` gem and do not contain its implementation.

- `fileutils-1.7.3.synthetic.gem` contains a marker implementation so the test
  can prove that the locked external version, rather than Ruby's bundled
  FileUtils, actually ran. Regenerate it by running `ruby build.rb` from
  `fileutils-1.7.3/`, then move the output to this directory and rename it with
  the `.synthetic.gem` suffix.
- `fileutils-1.7.2.synthetic.gem` declares an intentionally missing runtime
  dependency. It verifies that activation failure does not run user code or
  mark installation complete. Regenerate it by running `ruby build.rb` from
  `fileutils-activation-failure/`, then move and rename its output here.

The regular browser suite uses the recorded Rainbow, Pastel, and tty-color
RubyGems archives instead of these synthetic packages.
