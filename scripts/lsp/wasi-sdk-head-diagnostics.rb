require "net/http"

module WasiSdkHeadDiagnostics
  HOST = "github.com"
  PATH_PATTERN = %r{\A/WebAssembly/wasi-sdk/releases/download/[A-Za-z0-9._/-]+\z}
  RELEVANT_HEADERS = {
    "retry-after" => "retry_after",
    "x-ratelimit-remaining" => "rate_limit_remaining",
    "x-ratelimit-reset" => "rate_limit_reset",
  }.freeze

  module HeadTrace
    def head(path, *args, **kwargs, &block)
      WasiSdkHeadDiagnostics.observe(address, path) { super }
    end
  end

  def self.install!(http_class = Net::HTTP)
    http_class.prepend(HeadTrace) unless http_class.ancestors.include?(HeadTrace)
  end

  def self.observe(host, path)
    return yield unless candidate?(host, path)

    begin
      response = yield
    rescue StandardError => error
      write_record(path, "exception=#{safe_exception_name(error)}")
      raise
    end

    fields = ["status=#{response.code}"]
    RELEVANT_HEADERS.each do |header, field|
      value = response[header]
      next unless value

      if header == "retry-after"
        value = value.match?(/\A\d{1,8}\z/) ? value : "present"
      else
        next unless value.match?(/\A\d{1,16}\z/)
      end
      fields << "#{field}=#{value}"
    end
    write_record(path, fields.join(" "))
    response
  end

  def self.candidate?(host, path)
    host.to_s.casecmp?(HOST) && path.is_a?(String) && PATH_PATTERN.match?(path)
  end

  def self.safe_exception_name(error)
    name = error.class.name || error.class.to_s
    name.gsub(/[^A-Za-z0-9_:]/, "")
  end

  def self.write_record(path, result)
    $stderr.puts("[wasi-sdk-head] host=#{HOST} path=#{path} #{result}")
  rescue StandardError
    # Diagnostics must not change the build's response or exception behavior.
    nil
  end
end
