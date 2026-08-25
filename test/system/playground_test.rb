require "application_system_test_case"

class PlaygroundTest < ApplicationSystemTestCase
  # Compiling ruby.wasm and booting the VM is the slowest thing on the page and
  # the only step whose duration depends on the machine, so it gets its own
  # budget rather than Capybara's default two seconds.
  RUBY_VM_BOOT_WAIT = 30

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

  # Turbo Drive swaps the <body> but keeps the document, so the bundle's module
  # script runs exactly once no matter how many times its tag is re-inserted.
  # Everything below is about what the playground has to do for itself as a
  # result -- none of it is reproducible outside a real browser.

  test "the editor still runs code after Turbo leaves the playground and comes back" do
    visit root_path
    assert_selector "textarea#code"

    turbo_visit new_session_path
    assert_field "email_address"
    turbo_visit root_path
    assert_selector "textarea#code"

    fill_in "code", with: "6 * 7"

    assert_selector "#output", text: "42", wait: RUBY_VM_BOOT_WAIT
    assert_current_path(/\?c=/, url: true)
  end

  test "a keystroke just before a Turbo visit leaves the destination URL alone" do
    visit root_path
    assert_selector "textarea#code"

    type_and_leave_at_once "Turbo.visit('#{new_session_path}')"
    assert_field "email_address"
    wait_out_the_run_debounce

    assert_no_match(/\?c=/, page.current_url)
  end

  test "a keystroke just before a Turbo form submission leaves the destination URL alone" do
    sign_in_as users(:one) # which lands back on the playground

    # Logout is the form submission a visitor can actually reach from here, and
    # it reports itself to the page as turbo:submit-start rather than turbo:visit.
    type_and_leave_at_once "document.querySelector('.site-header__logout').click()"
    assert_field "email_address"
    wait_out_the_run_debounce

    assert_no_match(/\?c=/, page.current_url)
  end

  test "leaving the playground terminates the Ruby VM it left running" do
    visit root_path
    count_worker_terminations
    fill_in "code", with: "6 * 7"
    assert_selector "#output", text: "42", wait: RUBY_VM_BOOT_WAIT
    terminations_before_leaving = worker_terminations

    turbo_visit new_session_path

    assert_field "email_address"
    assert_equal terminations_before_leaving + 1, worker_terminations
  end

  private

  def turbo_visit(path)
    page.execute_script("Turbo.visit('#{path}')")
  end

  # Typing and leaving have to happen inside one script: driving them as two
  # Capybara calls puts a round trip between them, and the 300ms debounce this
  # is about would often have fired already by the time the second one lands.
  def type_and_leave_at_once(leave_script)
    page.execute_script(<<~JS)
      const codeInput = document.getElementById("code");
      codeInput.value = "puts 'typed just before leaving'";
      codeInput.dispatchEvent(new Event("input"));
      #{leave_script};
    JS
  end

  # What is under test is a timer that must *not* fire, and no assertion can
  # wait for an absence. Queueing a longer timer on the browser's own clock
  # can: the debounce was scheduled first, so once this one has run, it has
  # had its chance.
  def wait_out_the_run_debounce
    page.evaluate_async_script("const done = arguments[0]; setTimeout(done, 500);")
  end

  # A terminate() the page makes on its way out is invisible from the outside,
  # so count the calls from inside. Patched after the page has loaded, which is
  # all this needs: the run under test starts its worker later.
  def count_worker_terminations
    page.execute_script(<<~JS)
      window.workerTerminations = 0;
      const terminate = Worker.prototype.terminate;
      Worker.prototype.terminate = function () {
        window.workerTerminations++;
        return terminate.call(this);
      };
    JS
  end

  def worker_terminations
    page.evaluate_script("window.workerTerminations")
  end

  def sign_in_as(user)
    visit new_session_path
    fill_in "email_address", with: user.email_address
    fill_in "password", with: "password"
    click_button "Sign in"
    # Signing in redirects to the playground, and click_button returns without
    # waiting for that: assert the page it lands on before touching the editor.
    assert_selector "button", text: "Logout"
    assert_selector "textarea#code"
  end

  def panes_flex_direction
    page.evaluate_script(
      "getComputedStyle(document.querySelector('.playground__panes')).flexDirection"
    )
  end
end
