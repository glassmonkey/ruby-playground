require "application_system_test_case"

class PlaygroundTest < ApplicationSystemTestCase
  test "visiting the root path renders the playground page" do
    visit root_path

    assert_selector "h1", text: "Ruby Playground"
    assert_selector "textarea#code"
    assert_selector "pre#output"
  end
end
