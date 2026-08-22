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
    assert_current_path(/\?c=/, url: true)
    shared_url = page.current_url

    visit shared_url

    assert_field "code", with: "puts 'shared snippet'"
  end
end
