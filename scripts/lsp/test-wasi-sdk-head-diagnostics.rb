require "minitest/autorun"
require_relative "wasi-sdk-head-diagnostics"

class WasiSdkHeadDiagnosticsTest < Minitest::Test
  PATH = "/WebAssembly/wasi-sdk/releases/download/wasi-sdk-24/wasi-sdk-24.0-x86_64-linux.tar.gz"

  class FakeResponse
    attr_reader :code

    def initialize(code, headers = {})
      @code = code
      @headers = headers.transform_keys(&:downcase)
    end

    def [](name)
      @headers[name.downcase]
    end
  end

  class FakeHTTP
    attr_reader :address, :calls

    def initialize(address, result)
      @address = address
      @result = result
      @calls = []
    end

    def head(path, headers = {}, destination = nil)
      @calls << [path, headers, destination]
      raise @result if @result.is_a?(Exception)

      @result
    end
  end

  def setup
    WasiSdkHeadDiagnostics.install!(FakeHTTP)
  end

  def test_logs_statuses_without_changing_return_value_or_head_arguments
    ["302", "404", "403", "429", "500", "503"].each do |status|
      response = FakeResponse.new(status, "Location" => "https://signed.invalid/secret")
      http = FakeHTTP.new("github.com", response)
      headers = { "Accept" => "application/octet-stream" }
      returned = nil

      _stdout, stderr = capture_io do
        returned = http.head(PATH, headers, :destination)
      end

      assert_same response, returned
      assert_equal [[PATH, headers, :destination]], http.calls
      assert_includes stderr, "host=github.com path=#{PATH} status=#{status}"
      refute_includes stderr, "Location"
      refute_includes stderr, "signed.invalid"
      refute_includes stderr, "secret"
    end
  end

  def test_logs_only_retry_after_and_rate_limit_fields
    response = FakeResponse.new(
      "429",
      "Retry-After" => "60",
      "X-RateLimit-Remaining" => "0",
      "X-RateLimit-Reset" => "1793873974",
      "Location" => "https://signed.invalid/token",
      "Set-Cookie" => "credential=private",
    )
    http = FakeHTTP.new("github.com", response)

    _stdout, stderr = capture_io { http.head(PATH) }

    assert_includes stderr, "retry_after=60"
    assert_includes stderr, "rate_limit_remaining=0"
    assert_includes stderr, "rate_limit_reset=1793873974"
    refute_includes stderr, "signed.invalid"
    refute_includes stderr, "credential"
    refute_includes stderr, "private"
  end

  def test_does_not_emit_non_numeric_retry_after_content
    response = FakeResponse.new("429", "Retry-After" => "credential=private")
    http = FakeHTTP.new("github.com", response)

    _stdout, stderr = capture_io { http.head(PATH) }

    assert_includes stderr, "retry_after=present"
    refute_includes stderr, "credential"
    refute_includes stderr, "private"
  end

  def test_logs_exception_class_and_reraises_the_original_exception
    error = IOError.new("https://github.com/WebAssembly/wasi-sdk/releases/download/private-token")
    http = FakeHTTP.new("github.com", error)
    raised = nil

    _stdout, stderr = capture_io do
      raised = assert_raises(IOError) { http.head(PATH) }
    end

    assert_same error, raised
    assert_includes stderr, "host=github.com path=#{PATH} exception=IOError"
    refute_includes stderr, "private-token"
  end

  def test_does_not_log_or_change_non_candidate_requests
    response = FakeResponse.new("200")
    cases = [
      ["api.github.com", PATH],
      ["github.com", "/WebAssembly/other/releases/download/sdk.tar.gz"],
      ["github.com", "https://github.com/WebAssembly/wasi-sdk/releases/download/sdk.tar.gz"],
      ["github.com", "#{PATH}?token=private"],
    ]

    cases.each do |host, path|
      http = FakeHTTP.new(host, response)
      returned = nil
      _stdout, stderr = capture_io { returned = http.head(path) }

      assert_same response, returned
      assert_empty stderr
      assert_equal [[path, {}, nil]], http.calls
    end
  end

  def test_preserves_unrelated_request_exceptions_without_logging
    error = EOFError.new("private network detail")
    http = FakeHTTP.new("example.com", error)
    raised = nil

    _stdout, stderr = capture_io do
      raised = assert_raises(EOFError) { http.head(PATH) }
    end

    assert_same error, raised
    assert_empty stderr
  end

  def test_install_is_idempotent_on_net_http_without_making_a_request
    WasiSdkHeadDiagnostics.install!(Net::HTTP)
    WasiSdkHeadDiagnostics.install!(Net::HTTP)
    count = Net::HTTP.ancestors.count do |ancestor|
      ancestor == WasiSdkHeadDiagnostics::HeadTrace
    end

    assert_equal 1, count
  end
end
