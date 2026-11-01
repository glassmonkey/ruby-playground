/**
 * RubyGems' own rule for gem names (Gem::SpecificationPolicy#validate_name):
 * only letters, digits, ".", "-" and "_", at least one letter, and no leading
 * ".", "-" or "_". Uppercase is allowed because older gems such as RedCloth
 * use it. Kept in its own module so the app can import the same rule.
 */
export const GEM_NAME = /^(?![._-])[0-9._-]*[A-Za-z][A-Za-z0-9._-]*$/;

/**
 * A .gem file is name-version[-platform].gem, so it starts like a gem name.
 * The name and version cannot be split reliably here, since both may contain
 * "-", so only the shared start and character set are checked.
 */
export const GEM_FILE = /^(?![._-])[0-9._-]*[A-Za-z][A-Za-z0-9._-]*\.gem$/;
