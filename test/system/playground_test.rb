require "application_system_test_case"

class PlaygroundTest < ApplicationSystemTestCase
  test "visiting the root path renders the playground page" do
    visit root_path

    assert_selector "h1", text: "Ruby Playground"
    assert_selector "textarea#code"
    assert_selector "pre#output"
  end

  test "editing the code updates the URL's c param without navigating away" do
    visit root_path

    fill_in "code", with: "1 + 1"

    assert_current_path(/\?c=/, url: true)
  end

  test "loading a URL with a c param decodes it back into the editor" do
    visit root_path
    fill_in "code", with: "puts 'shared snippet'"
    # Wait for the debounced pushState to land before reading current_url:
    # unlike Capybara's finder/assertion methods, current_url does not retry.
    assert_current_path(/\?c=/, url: true)
    shared_url = page.current_url

    visit shared_url

    assert_field "code", with: "puts 'shared snippet'"
  end

  test "loading a URL with a broken c param falls back to the default snippet" do
    visit root_path
    default_code = find_field("code").value
    # Guard the fixture itself: if the fallback guard in index.js regresses,
    # this visit alone can blank out default_code, making the assertion
    # below vacuously true no matter what a broken c param does.
    assert_not_empty default_code

    visit "#{root_path}?c=not-a-valid-lzstring-payload"

    assert_field "code", with: default_code
  end
end
