require "application_system_test_case"

class PlaygroundTest < ApplicationSystemTestCase
  test "visiting the root path renders the playground page" do
    visit root_path

    assert_selector "h1", text: "Ruby Playground"
    assert_selector "textarea#code"
    assert_selector "pre#output"
  end

  test "editor and output panes are arranged side by side on a wide viewport" do
    page.driver.browser.manage.window.resize_to(1200, 900)

    visit root_path

    assert_equal "row", panes_flex_direction
  end

  test "editor and output panes stack vertically on a narrow viewport" do
    page.driver.browser.manage.window.resize_to(480, 900)

    visit root_path

    assert_equal "column", panes_flex_direction
  end

  private

  def panes_flex_direction
    page.evaluate_script(
      "getComputedStyle(document.querySelector('.playground__panes')).flexDirection"
    )
  end
end
